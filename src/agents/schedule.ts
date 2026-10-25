import {
  avgSleepHours,
  computeTimeBlocks,
  describeBlocks,
  hasBackToBack,
  hasFreeBlockBefore,
  lastNightSleep,
  lunchCrunch,
  todayCourses,
  tonightFreeBlock,
  upcomingExams,
} from '@/data/queries';
import { getSleepLogs } from '@/data/store/profile';
import { fmtMin } from '@/types/contract';
import type { AgentModule, AgentResult, Finding } from '@/types/contract';

/**
 * 日程 Agent：时间块切分 / 风险预警 / DDL 预警
 * 风险清单：早八连排、午休被课吃掉、DDL 前没有整块复习时间。
 */
export const scheduleAgent: AgentModule = {
  id: 'schedule',
  name: '日程',
  version: '0.1.0',
  capabilities: ['timeblock.analyze', 'ddl.warn'],
  defaultWeight: 2,
  enabled: true,

  async run(ctx) {
    const findings: Finding[] = [];
    const courses = await todayCourses(ctx.now);
    const blocks = computeTimeBlocks(courses);

    findings.push({
      id: 'schedule:timeblocks',
      type: 'fact',
      topic: '时间块',
      confidence: 3,
      summary: describeBlocks(blocks),
      evidences: [{ agentId: 'schedule', text: '切分规则：上课 / 整块空档(≥2h) / 碎片(<2h)', confidence: 3 }],
    });

    // 早八与连排是两件独立的事，各报一条。
    // 原来是 if / else if：两个都成立时只报「早八连排」，单独那条早八预警被吞掉。
    const firstClass = courses.find((c) => c.startMin <= 480);
    if (firstClass) {
      findings.push({
        id: 'schedule:early8',
        type: 'warning',
        topic: '早八',
        confidence: 3,
        summary: `今天有早八（${fmtMin(firstClass.startMin)} 上「${firstClass.name}」），前一晚早点收工`,
        evidences: [
          {
            agentId: 'schedule',
            text: `${fmtMin(firstClass.startMin)} 开始，地点「${firstClass.location}」`,
            confidence: 3,
          },
        ],
      });
    }
    if (hasBackToBack(courses)) {
      findings.push({
        id: 'schedule:back2back',
        type: 'warning',
        topic: '连排',
        confidence: 3,
        summary: '上午两节课连排，课间不到 15 分钟，几乎没有喘息的空隙',
      });
    }

    const lunch = lunchCrunch(courses);
    if (lunch) {
      findings.push({
        id: 'schedule:lunch-crunch',
        type: 'warning',
        topic: '午休',
        confidence: 3,
        summary: `「${lunch.name}」${lunch.startMin <= 690 ? '横跨' : '压着'}午休时段，午饭后基本没有整块休息时间`,
      });
    }

    // DDL 预警与冲突主张是两条独立规则：
    // ① §4.2 风险预警（稀缺）：48h 内有 DDL 且之前没有 ≥2h 整块空档 → warning
    // ② §5.3 冲突主张（争夺）：48h 内有 DDL 且今晚存在整块空档 → 主张该空档用于复习，
    //    与健康 Agent 的「提前睡」主张构成 L2 真冲突
    const urgent = await upcomingExams(ctx.now, 2);
    const nearest = urgent[0];
    const hoursLeft = nearest
      ? Math.round((new Date(nearest.at).getTime() - ctx.now.getTime()) / 3600_000)
      : 0;

    if (nearest && !(await hasFreeBlockBefore(ctx.now, new Date(nearest.at)))) {
      findings.push({
        id: 'schedule:ddl-crunch',
        type: 'warning',
        topic: '复习',
        confidence: 3,
        summary: `「${nearest.title}」之前没有 ≥2h 的整块复习时间，需要挪用休息时间`,
        evidences: [{ agentId: 'schedule', text: `DDL 在 ${hoursLeft}h 后`, confidence: 3 }],
      });
    }

    const result: AgentResult = { agentId: 'schedule', findings };

    // 日程 Agent 的第二条真建议：早八那一早的时间怎么排。
    // 原来它只会报「今天有早八」，报完就没了——预警不等于调度。
    // 这里按「课上几点开始」倒推起床时间，三个档位的差别只有一件事：愿意花多久在早饭和路上。
    if (firstClass) {
      const WALK_MIN = 10; // 从宿舍走到教室，按 10 分钟估
      const CUSHION_MIN = 5; // 进教室后留 5 分钟缓冲
      const plans = [
        {
          id: 'early8-canteen',
          prep: 35,
          label: '食堂坐着吃',
          pros: ['热乎，能坐下来', '上午不容易饿到第三节课'],
          cons: ['这是三个档里起得最早的一档'],
          shortImpact: '坐得下来，第一节课的状态最稳',
        },
        {
          id: 'early8-grab',
          prep: 15,
          label: '路上买着吃',
          pros: ['比食堂多睡 20 分钟', '不耽误上课'],
          cons: ['边走边吃，狼吞虎咽', '第三节课前容易饿'],
          shortImpact: '缓冲只有 5 分钟，路上不能出岔子',
        },
        {
          id: 'early8-skip',
          prep: 5,
          label: '不吃直接去',
          pros: ['睡到最后一刻', '不会迟到'],
          cons: ['第三节课大概率饿得听不进去', '整个上午的注意力靠硬撑'],
          shortImpact: '饿感大概在第三节课前来',
        },
      ];
      const options = plans.map((plan) => {
        const wakeMin = firstClass.startMin - CUSHION_MIN - WALK_MIN - plan.prep;
        return {
          id: plan.id,
          title: `${fmtMin(wakeMin)} 起，${plan.label}（${plan.prep >= 35 ? '坐得下来' : '不耽误课'}）`,
          note: plan.id === 'early8-canteen' ? `食堂早饭 · ${fmtMin(firstClass.startMin)} 上「${firstClass.name}」` : `${fmtMin(firstClass.startMin)} 上「${firstClass.name}」`,
          when: `明早 ${fmtMin(wakeMin)} 出门`,
          cost: { timeMin: firstClass.startMin - wakeMin, effort: (plan.prep >= 35 ? 2 : 1) as 1 | 2 },
          pros: plan.pros,
          cons:
            plan.id === 'early8-canteen'
              ? [`比「${plans[2].label}」早起 ${plans[0].prep - plans[2].prep} 分钟`]
              : plan.cons,
          fallback: plan.id === 'early8-skip' ? '空着肚子撑到第三节课，中途很难补' : '闹钟仍按最晚那档，路上出岔子就迟到',
          impacts: [
            { horizon: 'short' as const, text: plan.shortImpact, agentId: 'schedule' as const },
            { horizon: 'long' as const, text: '早八这天的上午状态，多半由这一顿决定', agentId: 'health' as const },
          ],
          evidences: [
            {
              agentId: 'schedule' as const,
              text: `${fmtMin(firstClass.startMin)} 上「${firstClass.name}」；按步行 ${WALK_MIN} 分钟、进教室留 ${CUSHION_MIN} 分钟倒推`,
              confidence: 3 as const,
            },
          ],
        };
      });
      findings.push({
        id: 'schedule:early8-plan',
        type: 'fact',
        topic: '早八怎么起',
        confidence: 2,
        summary: `早八那一早，从起床到进教室要留出 ${plans[0].prep + WALK_MIN + CUSHION_MIN} 到 ${plans[2].prep + WALK_MIN + CUSHION_MIN} 分钟`,
        evidences: [
          {
            agentId: 'schedule',
            text: '按课表里的上课时间倒推，步行按 10 分钟估',
            confidence: 2,
          },
        ],
      });
      result.suggestions = [
        {
          id: 'sug-early8-plan',
          topic: '早八那一早',
          priority: 1,
          slot: 'morning',
          sourceFindingIds: ['schedule:early8-plan'],
          options,
        },
      ];
    }
    const tonight = await tonightFreeBlock(ctx.now);
    if (nearest && tonight) {
      // L2 真冲突的日程方：主张把今晚这段整块留给复习。
      // 代价一律用真实数据算，不写死「连续第 4 天」这种可能对不上的话。
      const logs = await getSleepLogs();
      const lastNight = lastNightSleep(logs, ctx.now);
      const avg3 = avgSleepHours(logs, 3, ctx.now);
      // 「今晚」只算 18:00 之后那段：没课的日子空档从早上就开始了，不能把白天也算进来
      const eveningFrom = Math.max(tonight.startMin, 18 * 60);
      const eveningTo = Math.min(tonight.endMin, 23 * 60);
      const blockHours = ((eveningTo - eveningFrom) / 60).toFixed(1);
      result.conflictClaims = [
        {
          topic: '今晚的空档',
          side: 'study',
          plan: {
            id: 'plan-study-first',
            agentId: 'schedule',
            title: `学习优先：今晚 ${fmtMin(eveningFrom)}–${fmtMin(eveningTo)} 留给「${nearest.title}」`,
            cost: { timeMin: Number(blockHours) * 60 },
            pros: [
              `DDL 还有 ${hoursLeft}h，今晚能推进约 ${blockHours}h`,
              '整块时间不断开，比拆成碎片更有效率',
            ],
            cons: [
              lastNight ? `昨晚只睡 ${lastNight.hours}h，再晚睡明早容易废掉` : '缺觉状态下硬撑，效率打折扣',
              avg3 !== null ? `近 3 天平均 ${avg3.toFixed(1)}h，已经欠着` : '这一周的睡眠本来就不多',
            ],
            impacts: [
              { horizon: 'short', text: '明早前两节课注意力下降风险高', agentId: 'schedule' },
              { horizon: 'long', text: '缺觉累积，或影响周末考试状态', agentId: 'health' },
            ],
            evidences: [
              {
                agentId: 'schedule',
                text: `「${nearest.title}」DDL 在 ${hoursLeft}h 后；今晚 ${fmtMin(eveningFrom)}–${fmtMin(eveningTo)} 有整块空档`,
                confidence: 2,
              },
              ...(lastNight ? [{ agentId: 'health' as const, text: `昨晚睡 ${lastNight.hours}h`, confidence: 3 as const }] : []),
            ],
          },
        },
      ];
    }
    return result;
  },
};
