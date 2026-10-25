import { getSleepLogs } from '@/data/store/profile';
import {
  SLEEP_NEED_HOURS,
  avgSleepHours,
  bedtimeRegularity,
  hasBackToBack,
  hasEarlyEight,
  hoursIfSleepNow,
  lastNightSleep,
  sleepDebt,
  todayCourses,
  tonightFreeBlock,
  wakePlanOf,
  weekOverWeek,
} from '@/data/queries';
import { fmtMin } from '@/types/contract';
import type { AgentModule, AgentResult, Finding, OptionCard } from '@/types/contract';

/** 没有记录就说没有记录，不拿健康基线冒充实测；中文里「平均 没有记录」读着别扭，所以整句换掉 */
function avg3Phrase(v: number | null): string {
  return v === null ? '近 3 天没有记录' : `近 3 天平均 ${v.toFixed(1)}h`;
}

/**
 * 健康 Agent：睡眠 × 课表联动
 * - 昨晚 <6h 且今天早八/连排 → 午间小憩选项卡
 * - 晚间 → 熬夜提醒（「现在睡能睡 X 小时」）
 * - 近三天平均 <6h → 对今晚空档提出「提前睡」主张（与日程 Agent 构成真冲突）
 * - 不服从自动降级：同类建议连续未执行 → 换更轻量版本（§4.6）
 */
export const healthAgent: AgentModule = {
  id: 'health',
  name: '健康',
  version: '0.1.0',
  capabilities: ['sleep.assess', 'fatigue.warn'],
  defaultWeight: 2,
  enabled: true,

  async run(ctx) {
    const findings: Finding[] = [];
    const suggestions: AgentResult['suggestions'] = [];
    const claims: AgentResult['conflictClaims'] = [];

    const logs = await getSleepLogs();
    const lastNight = lastNightSleep(logs, ctx.now);
    const avg3 = avgSleepHours(logs, 3, ctx.now);
    const avg7 = avgSleepHours(logs, 7, ctx.now);
    const courses = await todayCourses(ctx.now);
    const hour = ctx.now.getHours() + ctx.now.getMinutes() / 60;
    const wake = await wakePlanOf(ctx.now);
    const wakeText = `明早 ${fmtMin(wake.wakeMin)} 起${
      wake.reason === 'class' && wake.firstClass ? `（有 ${wake.firstClass.name}）` : ''
    }`;
    const avg3Text = avg3 === null ? '近 3 天没有记录' : `近 3 天平均 ${avg3.toFixed(1)}h`;
    const avg7Text = avg7 === null ? '近一周没有记录' : `近一周平均 ${avg7.toFixed(1)}h`;

    findings.push({
      id: 'health:sleep-overview',
      type: 'fact',
      topic: '睡眠',
      confidence: 3,
      summary: `昨晚${lastNight ? `睡 ${lastNight.hours}h` : '没有记录'}，${avg3Text}，${avg7Text}；${wakeText}`,
      evidences: [
        {
          agentId: 'health',
          text:
            wake.reason === 'class'
              ? '起床时间按次日课表最早一节反推（课前 40 分钟），数据来源：本地课表'
              : '次日没有课，按 8:30 起床估算',
          confidence: 3,
        },
      ],
    });

    // ── 睡眠债 / 规律性 / 本周对比 ──
    // 这三条是「一周尺度」的判断，和上面「昨晚」的即时判断分开说，
    // 免得一句话里既有 5.5h 又有 6.1h 却没交代清楚各自的口径。
    const debt = sleepDebt(logs, 7, ctx.now);
    const rhythm = bedtimeRegularity(logs, 7, ctx.now);
    const week = weekOverWeek(logs, ctx.now);

    const loadParts: string[] = [];
    if (debt) loadParts.push(`睡眠债 ${debt.debtHours}h（近 ${debt.covered} 晚按 ${SLEEP_NEED_HOURS}h 算）`);
    if (rhythm) loadParts.push(`入睡时间波动 ±${rhythm.stdMin} 分钟`);
    if (week.delta !== null && week.thisWeek !== null) {
      const dir = week.delta >= 0 ? '多' : '少';
      loadParts.push(`本周平均 ${week.thisWeek.toFixed(1)}h，比上周${dir} ${Math.abs(week.delta).toFixed(1)}h`);
    }
    if (loadParts.length > 0) {
      findings.push({
        id: 'health:sleep-load',
        type: 'fact',
        topic: '睡眠',
        confidence: 3,
        summary: loadParts.join('；'),
        evidences: [
          {
            agentId: 'health',
            text: `口径：每晚报 7.5h 记一次缺口；入睡时间波动是近 7 晚入睡时刻的标准差${debt ? `，只算有记录的 ${debt.covered} 晚` : ''}`,
            confidence: 3,
          },
        ],
      });
    }

    // 欠得多才报，不把「某一晚少睡一小时」也写成风险
    if (debt && debt.debtHours >= 6) {
      const worstText = debt.worst
        ? `，欠得最多的是 ${debt.worst.date} 那晚只睡 ${debt.worst.hours}h`
        : '';
      findings.push({
        id: 'health:sleep-debt-warn',
        type: 'warning',
        topic: '睡眠',
        confidence: 2,
        summary: `近 ${debt.covered} 晚累计睡眠债 ${debt.debtHours}h${worstText}`,
        evidences: [
          {
            agentId: 'health',
            text: `欠得最多的是 ${debt.worst?.date ?? '—'} 那晚 ${debt.worst?.hours ?? 0}h`,
            confidence: 3,
          },
        ],
      });
    }

    if (rhythm && rhythm.stdMin >= 90) {
      findings.push({
        id: 'health:sleep-irregular',
        type: 'warning',
        topic: '睡眠',
        confidence: 2,
        summary: `入睡时间波动 ±${rhythm.stdMin} 分钟，作息不太规律`,
        evidences: [
          {
            agentId: 'health',
            text: `近 ${rhythm.covered} 晚入睡时刻的标准差为 ${rhythm.stdMin} 分钟（<30 稳 / 30–60 一般 / >90 乱）`,
            confidence: 3,
          },
        ],
      });
    }

    // ── 午间小憩建议 ──
    const sleepForNap = lastNight?.hours ?? avg3 ?? 8;
    if (sleepForNap < 6 && (hasEarlyEight(courses) || hasBackToBack(courses))) {
      findings.push({
        id: 'health:fatigue-3d',
        type: 'warning',
        topic: '睡眠',
        confidence: 2,
        summary: `昨晚睡眠不足 6h，且今天${hasEarlyEight(courses) ? '有早八' : ''}${hasBackToBack(courses) ? '连排' : ''}，下午犯困风险高`,
      });

      // §4.6 自动降级：连续 2 次未执行 → 换更轻量版本
      const napStat = ctx.preferences.compliance['午间小憩'];
      const degraded = !!napStat && napStat.shown >= 2 && napStat.done === 0;

      const normal: OptionCard = {
        id: 'nap-20',
        title: '午间小憩 20 分钟',
        cost: { timeMin: 20 },
        pros: ['下午前两节课注意力明显回升'],
        cons: ['占用 20 分钟空档'],
        impacts: [{ horizon: 'short', text: '14:00 第一节课犯困概率显著降低', agentId: 'health' }],
        evidences: [
          { agentId: 'health', text: `昨晚${lastNight ? `睡眠 ${lastNight.hours}h` : '没有记录'} < 6h`, confidence: 3 },
        ],
      };
      const light: OptionCard = {
        id: 'nap-light',
        title: '闭眼听首歌 10 分钟',
        cost: { timeMin: 10 },
        pros: ['几乎不占时间', '心理负担最小'],
        cons: ['恢复效果弱于完整小憩'],
        impacts: [{ horizon: 'short', text: '下午状态略有改善', agentId: 'health' }],
        evidences: [{ agentId: 'health', text: '上次的小憩建议对你太重，已自动降级为轻量版', confidence: 2 }],
      };
      const skip: OptionCard = {
        id: 'nap-skip',
        title: '不休息，直接去自习',
        cost: { timeMin: 0 },
        pros: ['多 20 分钟自习时间'],
        cons: ['下午犯困风险高'],
        impacts: [{ horizon: 'short', text: '14:00–16:00 注意力下降风险高', agentId: 'health' }],
        evidences: [{ agentId: 'health', text: `${avg3Phrase(avg3)}`, confidence: 3 }],
      };

      suggestions.push({
        id: 'sug-nap',
        topic: '午间小憩',
        priority: 2,
        slot: 'noon',
        sourceFindingIds: ['health:fatigue-3d'],
        options: degraded ? [light, normal, skip] : [normal, light, skip],
      });
    }

    // ── 晚间熬夜提醒 ──
    if (hour >= 18) {
      const sleepNowHours = hoursIfSleepNow(ctx.now, wake.wakeMin).toFixed(1);
      const laterHours = (Number(sleepNowHours) - 1).toFixed(1);
      suggestions.push({
        id: 'sug-sleep-tonight',
        topic: '今晚几点睡',
        priority: 1,
        slot: 'evening',
        sourceFindingIds: ['health:sleep-overview'],
        options: [
          {
            id: 'sleep-now',
            title: '现在就准备睡',
            cost: {},
            pros: [`能睡约 ${sleepNowHours} 小时，到 ${fmtMin(wake.wakeMin)} 起床`],
            cons: ['晚上的娱乐 / 刷机时间取消'],
            impacts: [
              {
                horizon: 'short',
                text:
                  wake.reason === 'class' && wake.firstClass
                    ? `${fmtMin(wake.firstClass.startMin)} 有 ${wake.firstClass.name}，早起状态能撑住`
                    : '明早按自己的节奏起床，不至于睡过头',
                agentId: 'health',
              },
            ],
            evidences: [
              { agentId: 'health', text: `${avg3Phrase(avg3)}`, confidence: 3 },
              { agentId: 'health', text: `${wakeText}（按课表反推）`, confidence: 3 },
            ],
          },
          {
            id: 'sleep-later',
            title: '再刷 1 小时手机',
            cost: { timeMin: 60 },
            pros: ['今晚放松'],
            cons: [`今晚只剩约 ${laterHours} 小时睡眠`],
            impacts: [
              { horizon: 'short', text: '明早前两节课注意力下降风险高', agentId: 'health' },
              { horizon: 'long', text: '缺觉累积，本周精力趋势继续走低', agentId: 'health' },
            ],
            evidences: [{ agentId: 'health', text: '睡眠债已超过 3 天', confidence: 2 }],
          },
        ],
      });
    }

    // ── 对今晚空档的「提前睡」主张（真冲突的健康方） ──
    // 和日程 Agent 的「今晚整块拿来复习」主张同 topic → arbiter 生成 L2 卡。
    // 只有三个条件同时成立才开这张卡：近 3 天睡不够、今晚确实有可支配的空档、明天还要早起。
    const tonightSlot = await tonightFreeBlock(ctx.now);
    const debt7 = sleepDebt(logs, 7, ctx.now);
    if (avg3 !== null && avg3 < 6 && tonightSlot) {
      // 冲突点在「几点收工」：日程想用整晚空档，健康想 22:00 收工、23:00 睡下。
      // 空档常常从早上就开始（没课的一天），所以只取 18:00 之后那段，别把白天算进「今晚」。
      const eveningFrom = Math.max(tonightSlot.startMin, 18 * 60);
      const eveningTo = Math.min(tonightSlot.endMin, 23 * 60);
      const bedtimeMin = 23 * 60;
      const stopAt = 22 * 60;
      const cutMin = Math.max(0, eveningTo - stopAt);
      const hoursAt23 = ((((wake.wakeMin - bedtimeMin) % 1440) + 1440) % 1440) / 60;
      const moreThanLastNight = lastNight ? `${(hoursAt23 - lastNight.hours).toFixed(1)}h` : '—';
      const debtAfter = debt7 ? Math.max(0, debt7.debtHours - hoursAt23).toFixed(1) : null;
      claims.push({
        topic: '今晚的空档',
        side: 'health',
        plan: {
          id: 'plan-health-first',
          agentId: 'health',
          title: `健康优先：今晚 ${fmtMin(stopAt)} 收工，${fmtMin(bedtimeMin)} 睡、明早 ${fmtMin(wake.wakeMin)} 起（约 ${hoursAt23.toFixed(1)} 小时）`,
          cost: { timeMin: cutMin },
          pros: [
            lastNight ? `比昨晚多睡 ${moreThanLastNight}` : '把这一周的缺口补一点',
            wake.reason === 'class' && wake.firstClass
              ? `明早 ${fmtMin(wake.firstClass.startMin)} 有 ${wake.firstClass.name}，不缺觉才听得进去`
              : '明早按自己的节奏起床，不至于睡过头',
          ],
          cons: [cutMin > 0 ? `今晚的复习整块少 ${cutMin} 分钟（${fmtMin(stopAt)} 之后不再开工）` : `${fmtMin(stopAt)} 之后不再开工`],
          impacts: [
            {
              horizon: 'short',
              text: wake.reason === 'class' && wake.firstClass
                ? `${fmtMin(wake.firstClass.startMin)} 那节课不至于走神`
                : '明早起来不至于发懵',
              agentId: 'health',
            },
            { horizon: 'long', text: debtAfter !== null ? `这周睡眠债从 ${debt7?.debtHours.toFixed(1)}h 降到约 ${debtAfter}h` : '把这周的缺口压下去', agentId: 'health' },
          ],
          evidences: [
            { agentId: 'health', text: `${avg3Phrase(avg3)}，连续不足`, confidence: 3 },
            { agentId: 'health', text: debt7 ? `近 7 晚累计睡债 ${debt7.debtHours.toFixed(1)}h` : `${wakeText}`, confidence: 2 },
            { agentId: 'schedule', text: `今晚 ${fmtMin(eveningFrom)}–${fmtMin(eveningTo)} 有整块空档`, confidence: 2 },
          ],
        },
      });
    }

    const result: AgentResult = { agentId: 'health', findings };
    if (suggestions.length > 0) result.suggestions = suggestions;
    if (claims.length > 0) result.conflictClaims = claims;
    return result;
  },
};
