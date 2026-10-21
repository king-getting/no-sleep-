import { getSleepLogs } from '@/data/store/profile';
import { avgSleepHours, hasBackToBack, hasEarlyEight, lastNightSleep, todayCourses } from '@/data/queries';
import type { AgentModule, AgentResult, Finding, OptionCard } from '@/types/contract';

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
    const lastNight = lastNightSleep(logs);
    const avg3 = avgSleepHours(logs, 3);
    const avg7 = avgSleepHours(logs, 7);
    const courses = todayCourses(ctx.now);
    const hour = ctx.now.getHours() + ctx.now.getMinutes() / 60;

    findings.push({
      id: 'health:sleep-overview',
      type: 'fact',
      topic: '睡眠',
      confidence: 3,
      summary: `昨晚睡 ${lastNight?.hours ?? '-'}h，近 3 天平均 ${avg3.toFixed(1)}h，近一周平均 ${avg7.toFixed(1)}h`,
      evidences: [{ agentId: 'health', text: '数据来源：本地睡眠记录（示例数据）', confidence: 3 }],
    });

    // ── 午间小憩建议 ──
    if ((lastNight?.hours ?? 8) < 6 && (hasEarlyEight(courses) || hasBackToBack(courses))) {
      findings.push({
        id: 'health:fatigue-3d',
        type: 'warning',
        topic: '睡眠',
        confidence: 2,
        summary: `昨晚睡眠不足 6h，且今天${hasEarlyEight(courses) ? '有早八' : ''}${hasBackToBack(courses) ? '连排' : ''}，下午犯困风险高`,
      });

      // §4.6 自动降级：连续 2 次未执行 → 换更轻量版本
      const napStat = ctx.preferences.compliance['小憩'];
      const degraded = !!napStat && napStat.shown >= 2 && napStat.done === 0;

      const normal: OptionCard = {
        id: 'nap-20',
        title: '午间小憩 20 分钟',
        cost: { timeMin: 20 },
        pros: ['下午前两节课注意力明显回升'],
        cons: ['占用 20 分钟空档'],
        impacts: [{ horizon: 'short', text: '14:00 第一节课犯困概率显著降低', agentId: 'health' }],
        evidences: [{ agentId: 'health', text: `昨晚睡眠 ${lastNight?.hours}h < 6h`, confidence: 3 }],
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
        evidences: [{ agentId: 'health', text: `近 3 天平均睡眠 ${avg3.toFixed(1)}h`, confidence: 3 }],
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
      const wakeAt = 7 * 60; // 假设明早 7:00 起（有早八时）
      const sleepNowHours = (((24 * 60 - ctx.now.getHours() * 60 - ctx.now.getMinutes()) + wakeAt) / 60).toFixed(1);
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
            title: '现在就准备睡（23:00 前上床）',
            cost: {},
            pros: [`今晚能睡约 ${sleepNowHours} 小时`],
            cons: ['晚上的娱乐 / 刷机时间取消'],
            impacts: [{ horizon: 'short', text: '明早起床状态恢复，早八不痛苦', agentId: 'health' }],
            evidences: [{ agentId: 'health', text: `近 3 天平均 ${avg3.toFixed(1)}h，已处于缺觉状态`, confidence: 3 }],
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
    if (avg3 < 6) {
      claims.push({
        topic: 'tonight-slot',
        side: 'health',
        plan: {
          id: 'plan-health-first',
          agentId: 'health',
          title: '健康优先：23:00 睡，明早 7:00 起补 1h',
          cost: { timeMin: 60 },
          pros: ['睡眠恢复，明早状态好'],
          cons: ['复习时间 −1h'],
          impacts: [
            { horizon: 'short', text: '需挪用明晚 1h 整块时间补复习', agentId: 'schedule' },
            { horizon: 'long', text: '打断连续缺觉，周末考试状态回升', agentId: 'health' },
          ],
          evidences: [{ agentId: 'health', text: `近 3 天平均睡眠 ${avg3.toFixed(1)}h，连续不足`, confidence: 3 }],
        },
      });
    }

    const result: AgentResult = { agentId: 'health', findings };
    if (suggestions.length > 0) result.suggestions = suggestions;
    if (claims.length > 0) result.conflictClaims = claims;
    return result;
  },
};
