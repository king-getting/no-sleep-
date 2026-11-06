import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  GitMerge,
  MessageSquareWarning,
  Scale,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { AGENT_META } from '@/ui/agentMeta';
import { agentRegistry } from '@/agents/registry';
import { effectiveWeight } from '@/orchestrator/weights';
import { orchestratorEvents } from '@/orchestrator/events';
import type {
  AgentId,
  AgentResult,
  ConflictCard,
  Mode,
  OrchestratorEvent,
  Report,
} from '@/types/contract';
import { cn } from '@/lib/utils';

/**
 * Agent 讨论纪要（竖式）
 *
 * 为什么竖着排：报告只给结论，看不出「谁先提的、被谁拦下的」。
 * 这一栏按事件流真实发生的顺序，把一轮讨论铺成竖线：
 * 提议 → 被别家叫停 → 总控合并 → 权重调整 → 结论。
 * 折叠态只占一行；点开才占版面。
 *
 * 数据全部来自编排事件流（契约 §6），不 import 引擎内部，也不编造对话。
 */
type Turn =
  | {
      kind: 'propose';
      id: string;
      agentId: AgentId;
      topic: string;
      title: string;
      pros: string[];
      cons: string[];
      dropped: { title: string; why?: string }[];
    }
  | { kind: 'findings'; id: string; agentId: AgentId; lines: string[]; claimTopic?: string }
  | {
      kind: 'clash';
      id: string;
      topic: string;
      a: { agentId: AgentId; title: string; reason?: string };
      b: { agentId: AgentId; title: string; reason?: string };
      resolved?: 'A' | 'B';
    }
  | { kind: 'merge'; id: string; text: string }
  | { kind: 'weight'; id: string; rows: { agentId: AgentId; base: number; eff: number }[] }
  | { kind: 'conclusion'; id: string; text: string };

const WEIGHT_RE = /^权重调整/;
/** 引擎记账类的合并事件不是"讨论"，竖线里不展示 */
const NOISE_RE = /^生存模式：注入考试域产出/;
const TYPE_LABEL: Record<string, string> = {
  morning: '晨间报告',
  noon: '午间报告',
  evening: '晚间报告',
  'exam-day': '考试日冲刺',
  'exam-week': '冲刺周',
  'exam-done': '考后小结',
};

/**
 * 冲突行：谁主张、谁叫停。
 * 教务产的是硬约束（课不会等你），不管它排在 A 还是 B，都显示成「叫停」。
 */
function ClashBody({ t }: { t: Extract<Turn, { kind: 'clash' }> }) {
  const hardIsA = t.a.agentId === 'academic';
  const hardIsB = t.b.agentId === 'academic';
  const proposer = hardIsA ? t.b : t.a;
  const blocker = hardIsA ? t.a : t.b;
  const blockerIsHard = hardIsA || hardIsB;
  const label = (id: AgentId) => AGENT_META[id]?.name ?? id;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
      <p className="text-[11px] font-medium text-amber-900">
        {label(proposer.agentId)} 与 {label(blocker.agentId)} 撞上了 · {t.topic}
      </p>
      <div className="mt-1 space-y-1">
        <p className="text-[11px] leading-snug">
          <span className="font-medium">{label(proposer.agentId)}</span>
          <span className="text-muted-foreground"> 主张：</span>
          {proposer.title}
          {proposer.reason && (
            <span className="text-muted-foreground"> —— {proposer.reason}</span>
          )}
        </p>
        <p className="text-[11px] leading-snug">
          <span className="font-medium">{label(blocker.agentId)}</span>
          <span className="text-muted-foreground">
            {blockerIsHard ? ' 叫停（硬约束）：' : ' 叫停：'}
          </span>
          {blocker.title}
          {blocker.reason && (
            <span className="text-muted-foreground"> —— {blocker.reason}</span>
          )}
        </p>
      </div>
      <p className="mt-1 text-[10px] text-amber-800">
        {t.resolved ? `你已经拍板：方案 ${t.resolved}` : '两边都摆上桌了，等你拍板'}
      </p>
    </div>
  );
}

function buildTurns(
  history: OrchestratorEvent[],
  mode: Mode,
  resolutions: Record<string, 'A' | 'B'>,
): Turn[] {
  const turns: Turn[] = [];
  const baseOf = (id: AgentId) =>
    agentRegistry.find((a) => a.id === id)?.defaultWeight ?? 1;

  history.forEach((e, i) => {
    if (e.type === 'agent:done') {
      const r: AgentResult = e.result;
      const top = [...(r.suggestions ?? [])].sort((x, y) => x.priority - y.priority)[0];
      if (top && top.options[0]) {
        const picked = top.options[0];
        turns.push({
          kind: 'propose',
          id: `p${i}`,
          agentId: r.agentId,
          topic: top.topic,
          title: picked.title,
          pros: picked.pros.slice(0, 2),
          cons: picked.cons.slice(0, 2),
          dropped: top.options.slice(1, 3).map((o) => ({ title: o.title, why: o.cons[0] })),
        });
      } else if (r.findings.length > 0) {
        turns.push({
          kind: 'findings',
          id: `f${i}`,
          agentId: r.agentId,
          lines: r.findings.slice(0, 2).map((f) => f.summary),
        });
      }
      return;
    }
    if (e.type === 'conflict:detected') {
      const c: ConflictCard = e.conflict;
      turns.push({
        kind: 'clash',
        id: `c${i}`,
        topic: c.topic,
        a: { agentId: c.planA.agentId, title: c.planA.title, reason: c.planA.cons[0] },
        b: { agentId: c.planB.agentId, title: c.planB.title, reason: c.planB.cons[0] },
        resolved: resolutions[c.id],
      });
      return;
    }
    if (e.type === 'merge:applied') {
      if (WEIGHT_RE.test(e.text)) {
        const ids: AgentId[] = ['academic', 'life', 'health', 'schedule'];
        turns.push({
          kind: 'weight',
          id: `w${i}`,
          rows: ids
            .map((agentId) => ({
              agentId,
              base: baseOf(agentId),
              eff: effectiveWeight(baseOf(agentId), mode, agentId),
            }))
            .filter((r) => r.eff !== r.base || mode === 'exam'),
        });
        return;
      }
      if (NOISE_RE.test(e.text)) return;
      turns.push({ kind: 'merge', id: `m${i}`, text: e.text });
    }
  });

  const report = history.find((e) => e.type === 'report:composed');

  // 「只报了事实」的 Agent 如果其实在下面叫停了谁，得说清楚，不然读者会以为它什么也没主张
  const claimOf = new Map<AgentId, string>();
  const proposers = new Set(turns.filter((t) => t.kind === 'propose').map((t) => t.agentId));
  for (const t of turns) {
    if (t.kind !== 'clash') continue;
    for (const side of [t.a, t.b]) {
      if (!proposers.has(side.agentId)) claimOf.set(side.agentId, t.topic);
    }
  }
  for (const t of turns) {
    if (t.kind === 'findings' && claimOf.has(t.agentId)) {
      t.claimTopic = claimOf.get(t.agentId);
    }
  }

  if (report) {
    turns.push({ kind: 'conclusion', id: 'done', text: '总控汇总完毕，上面这一串就是这张报告的由来' });
  }
  return turns;
}

export function AgentDebate({
  report,
  resolutions = {},
}: {
  report: Report;
  resolutions?: Record<string, 'A' | 'B'>;
}) {
  const [history, setHistory] = useState<OrchestratorEvent[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const apply = () => setHistory([...orchestratorEvents.getHistory()]);
    apply();
    return orchestratorEvents.subscribe(apply);
  }, [report]);

  const mode: Mode = report.type.startsWith('exam') ? 'exam' : 'normal';
  const turns = useMemo(
    () => buildTurns(history, mode, resolutions),
    [history, mode, resolutions],
  );

  const participants = useMemo(() => {
    const ids = new Set<AgentId>();
    for (const e of history) if (e.type === 'agent:done') ids.add(e.agentId);
    return [...ids];
  }, [history]);

  if (turns.length < 2) return null;

  const label = (id: AgentId) => AGENT_META[id]?.name ?? id;

  return (
    <section className="mb-3 rounded-2xl border bg-card shadow-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Users className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {participants.length} 个 Agent 的讨论纪要
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {participants.map((id) => {
              const base = agentRegistry.find((a) => a.id === id)?.defaultWeight ?? 1;
              const eff = effectiveWeight(base, mode, id);
              return (
                <span key={id} className="rounded-full border px-1.5 py-px">
                  {label(id)} ×{eff}
                </span>
              );
            })}
            <span className="hidden sm:inline">· 谁提了什么、被谁叫停</span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 border-t bg-secondary/20 px-4 py-3">
          <ol className="relative space-y-0">
            <span className="absolute bottom-3 left-[13px] top-3 w-px bg-border" aria-hidden />
            {turns.map((t) => (
              <li key={t.id} className="relative flex gap-2.5 py-1.5">
                <span className="relative z-10 mt-0.5 shrink-0">
                  {t.kind === 'propose' || t.kind === 'findings' ? (
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-white',
                        AGENT_META[t.agentId].bg,
                      )}
                    >
                      {(() => {
                        const Icon = AGENT_META[t.agentId].icon;
                        return <Icon className="h-3.5 w-3.5" />;
                      })()}
                    </span>
                  ) : t.kind === 'clash' ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-700">
                      <MessageSquareWarning className="h-3.5 w-3.5" />
                    </span>
                  ) : t.kind === 'weight' ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border bg-card text-muted-foreground">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </span>
                  ) : t.kind === 'merge' ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border bg-card text-primary">
                      <GitMerge className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Scale className="h-3.5 w-3.5" />
                    </span>
                  )}
                </span>

                <div className="min-w-0 flex-1 pb-1">
                  {t.kind === 'propose' && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{label(t.agentId)}</span>
                        <span> 提议 · {t.topic}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] font-medium leading-snug">{t.title}</p>
                      <p className="mt-1 space-x-2 text-[11px] leading-snug">
                        {t.pros.map((p) => (
                          <span key={p} className="text-primary">
                            ＋{p}
                          </span>
                        ))}
                        {t.cons.map((c) => (
                          <span key={c} className="text-muted-foreground">
                            −{c}
                          </span>
                        ))}
                      </p>
                      {t.dropped.length > 0 && (
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                          它先考虑过：
                          {t.dropped
                            .map((d) => `${d.title}${d.why ? `（${d.why}）` : ''}`)
                            .join('；')}
                        </p>
                      )}
                    </div>
                  )}

                  {t.kind === 'findings' && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{label(t.agentId)}</span>
                        <span> 只报了事实，没给方案</span>
                        {t.claimTopic && (
                          <span className="text-amber-700">
                            {' '}（另外它对「{t.claimTopic}」有一条硬约束，见下）
                          </span>
                        )}
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {t.lines.map((l) => (
                          <li key={l} className="text-[11px] leading-snug text-muted-foreground">
                            · {l}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {t.kind === 'clash' && <ClashBody t={t} />}

                  {t.kind === 'merge' && (
                    <p className="rounded-lg border bg-card px-2.5 py-1.5 text-[11px] leading-snug">
                      <span className="font-medium text-primary">总控合并：</span>
                      <span className="text-muted-foreground">{t.text}</span>
                    </p>
                  )}

                  {t.kind === 'weight' && (
                    <div className="rounded-lg border bg-card px-2.5 py-1.5">
                      <p className="text-[11px] font-medium">按设置里的权重调整次序</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {t.rows.map((r) => (
                          <span key={r.agentId} className="tabular-nums">
                            {label(r.agentId)} {r.base}→{r.eff}
                            {r.eff >= 1.3 ? '（上浮）' : r.eff <= 0.8 ? '（降级）' : ''}
                          </span>
                        ))}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        改设置页的权重，这一行和上面几条的先后会一起变
                      </p>
                    </div>
                  )}

                  {t.kind === 'conclusion' && (
                    <p className="text-[12px] font-medium leading-snug">
                      {t.text}
                      <span className="ml-1 font-normal text-muted-foreground">
                        （{TYPE_LABEL[report.type] ?? report.type}）
                      </span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
