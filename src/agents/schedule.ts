import {
  computeTimeBlocks,
  describeBlocks,
  hasBackToBack,
  hasEarlyEight,
  hasFreeBlockBefore,
  lunchCrunch,
  todayCourses,
  tonightFreeBlock,
  upcomingExams,
} from '@/data/queries';
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

    if (hasEarlyEight(courses) && hasBackToBack(courses)) {
      findings.push({
        id: 'schedule:early8-back2back',
        type: 'warning',
        topic: '早八连排',
        confidence: 3,
        summary: '今天早八且连排：上午节奏紧张，早餐建议在 7:40 前解决',
      });
    } else if (hasEarlyEight(courses)) {
      findings.push({
        id: 'schedule:early8',
        type: 'warning',
        topic: '早八',
        confidence: 3,
        summary: '今天有早八（8:00 上课），明晚别熬太晚',
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
    const tonight = await tonightFreeBlock(ctx.now);
    if (nearest && tonight) {
      result.conflictClaims = [
        {
          topic: 'tonight-slot',
          side: 'study',
          plan: {
            id: 'plan-study-first',
            agentId: 'schedule',
            title: '学习优先：今晚复习至 23:30',
            cost: { timeMin: 150 },
            pros: ['复习时间充足，DDL 稳妥'],
            cons: ['睡眠连续第 4 天 <6h'],
            impacts: [
              { horizon: 'short', text: '明早前两节课注意力下降风险高', agentId: 'schedule' },
              { horizon: 'long', text: '缺觉累积，或影响周末考试状态', agentId: 'health' },
            ],
            evidences: [
              {
                agentId: 'schedule',
                text: `「${nearest.title}」DDL 在 ${hoursLeft}h 后；今晚 ${fmtMin(tonight.startMin)}–${fmtMin(tonight.endMin)} 有整块空档`,
                confidence: 2,
              },
            ],
          },
        },
      ];
    }
    return result;
  },
};
