import { getEnabledAgents } from '@/agents/registry';
import { getPreferences, getProfile } from '@/data/store/profile';
import { upcomingExams } from '@/data/queries';
import { examReportTypeOf, examWindowOf, justFinishedExam } from '@/lib/examMode';
import type { AgentContext, AgentResult, Mode, Report, ReportType } from '@/types/contract';
import { arbitrateClaims, mergeSuggestions } from './arbiter';
import { composeReport } from './compose';
import { collectTopicStats, downgradeByCompliance } from './compliance';
import { enrichSuggestions } from './enrich';
import { orchestratorEvents } from './events';
import { buildExamDoneResults, buildExamResults } from './exam';
import { applyAgentWeights } from './weights';

export type Trigger = 'morning-report' | 'noon-report' | 'evening-report' | 'user-ask';

export function reportTypeForTrigger(trigger: string, now: Date): ReportType {
  if (trigger === 'morning-report') return 'morning';
  if (trigger === 'noon-report') return 'noon';
  if (trigger === 'evening-report') return 'evening';
  const h = now.getHours();
  return h < 9 ? 'morning' : h < 15 ? 'noon' : 'evening';
}

/**
 * 总控编排器：意图识别 · 任务拆解 · 汇总
 * 执行全程发布编排事件（UI 编排动画的唯一数据源）。
 */
class Orchestrator {
  /**
   * @param trigger 触发源；演示模式配合 now 覆盖可手动唤出任意时段的报告
   */
  async run(trigger: Trigger, opts?: { now?: Date }): Promise<Report> {
    const now = opts?.now ?? new Date();
    const ev = orchestratorEvents;
    ev.emit({ type: 'run:start', trigger });

    // 只读快照：画像 + 偏好
    const [user, preferences] = await Promise.all([getProfile(), getPreferences()]);

    // 生存模式判定（A6）：考前 7 天进入 exam，考试当天走 exam-day 配方。
    // 演示旋钮优先：设置页打开「强制普通模式」时无论考期都按普通日报走，用于对比演示。
    const examItems = await upcomingExams(now, 8);
    const window = examWindowOf(examItems, now);
    const forceNormal = localStorage.getItem('xiaoshan:force-normal') === '1';
    // 考后小结（B10）：刚考完的那一场优先——这时候给「冲刺」是错的，该复盘
    const finished = forceNormal ? null : justFinishedExam(examItems, now);
    const mode: Mode = forceNormal || finished ? 'normal' : window.mode;

    const ctx: AgentContext = { user, preferences, mode, now };

    // 任务拆解 → 分派给专职 Agent，并行执行（每个 Agent 完成即发布 agent:done）
    const agents = getEnabledAgents();
    const results = await Promise.all(
      agents.map(async (agent): Promise<AgentResult> => {
        ev.emit({ type: 'agent:start', agentId: agent.id });
        try {
          const result = await agent.run(ctx);
          ev.emit({ type: 'agent:done', agentId: agent.id, result });
          return result;
        } catch (err) {
          // 单个 Agent 失败不拖垮整轮编排
          const fallback: AgentResult = {
            agentId: agent.id,
            findings: [
              {
                id: `${agent.id}:error`,
                type: 'warning',
                topic: '系统',
                confidence: 0,
                summary: `${agent.name} Agent 本轮执行失败：${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
          ev.emit({ type: 'agent:done', agentId: agent.id, result: fallback });
          return fallback;
        }
      }),
    );

    // 生存模式：注入考试域的产出（复习建议 / 赶考提醒 / 考前一晚冲突 / 权重调整）
    if (!finished && mode === 'exam') {
      const examResults = await buildExamResults(ctx, window);
      results.push(...examResults);
      ev.emit({
        type: 'merge:applied',
        text: '生存模式：注入考试域产出（复习安排 / 考前夜冲突卡）',
      });
    }

    // 考后小结：刚考完就复盘一次，不再给冲刺建议
    if (finished) {
      const doneResults = await buildExamDoneResults(ctx, finished, examItems);
      results.push(...doneResults);
      ev.emit({
        type: 'merge:applied',
        text: `考后小结：${finished.title} 已考完，本轮改成复盘而不是冲刺`,
      });
    }

    // 汇总：L2 真冲突 → 冲突卡；L1 可调和 → 自动合并
    const claims = results.flatMap((r) => r.conflictClaims ?? []);
    const conflicts = arbitrateClaims(claims, preferences);
    for (const conflict of conflicts) ev.emit({ type: 'conflict:detected', conflict });

    const merged = mergeSuggestions(results.flatMap((r) => r.suggestions ?? []));
    for (const text of merged.merges) ev.emit({ type: 'merge:applied', text });

    // 依据富化：跨域依据由总控在汇总阶段挂载（Agent 之间不越域读数据）
    const enriched = enrichSuggestions(merged.suggestions, results);

    // 遵从度回流（A8）：同一主题连续 2 次「没做」→ 本轮建议降一级
    const topicStats = await collectTopicStats();
    const { suggestions: ranked, downgraded } = downgradeByCompliance(enriched, topicStats);
    if (downgraded.length > 0) {
      const detail = downgraded.map((d) => `${d.topic}（连续 ${d.missStreak} 次没做，${d.from} → ${d.to}）`).join('；');
      ev.emit({ type: 'merge:applied', text: `遵从度回流：${detail}` });
    }

    // Agent 权重（生存模式才动 priority；普通模式只做同优先级排序）
    const weighted = applyAgentWeights(ranked, results, agents, mode);
    const moved = weighted.rows.filter((r) => r.moved > 0);
    if (mode === 'exam' && moved.length > 0) {
      const detail = moved
        .map((r) => `${r.agentId} ×${r.effective.toFixed(1)}${r.effective >= 1.3 ? '（上浮）' : '（降级）'}`)
        .join(' / ');
      ev.emit({ type: 'merge:applied', text: `权重调整：${detail}` });
    }

    // 按配方组装报告（生存模式下不是 morning/noon/evening，而是 exam-week / exam-day / exam-done）
    const type: ReportType = finished
      ? 'exam-done'
      : mode === 'exam'
        ? examReportTypeOf(window)
        : reportTypeForTrigger(trigger, now);
    const report = await composeReport(type, results, weighted.suggestions, conflicts, ctx);
    ev.emit({ type: 'report:composed', report });
    return report;
  }
}

export const orchestrator = new Orchestrator();
