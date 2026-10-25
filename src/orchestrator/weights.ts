import type { AgentId, AgentModule, AgentResult, Mode, Suggestion } from '@/types/contract';

/**
 * Agent 权重（契约 §4.1「生存模式下由编排器动态调整」的落地处）
 *
 * 为什么需要这一层：四个 Agent 都声明了 defaultWeight，设置页也在展示它，
 * 但在此之前**没有任何代码读过它**——生存模式用的是 exam.ts 里另一张硬编码表。
 * 现在统一成：有效权重 = defaultWeight × 生存因子（普通模式因子为 1）。
 *
 * 设计取舍：
 * - 普通模式**不动 priority**，权重只作为同优先级内的排序依据。
 *   否则午饭（priority 1、权重 1）会被永久压到睡眠后面，等于把日常报告改坏。
 * - 生存模式才按有效权重升/降一级：≥1.3 上浮，≤0.8 降级，其余不动。
 *   默认权重 2/1/2/2 乘上因子 0.6/0.5/0.65/0.7 = 1.2/0.5/1.3/1.4，
 *   与之前硬编码的「schedule ×1.4 / health ×1.3」完全一致，所以默认行为不变；
 *   改 defaultWeight 才会改变结果——这正是设置页那个旋钮该有的样子。
 */
export const SURVIVAL_FACTOR: Record<AgentId, number> = {
  academic: 0.6,
  life: 0.5,
  health: 0.65,
  schedule: 0.7,
};

const LIFT_AT = 1.3;
const DEMOTE_AT = 0.8;

export function effectiveWeight(base: number, mode: Mode, agentId: AgentId): number {
  const raw = mode === 'exam' ? base * SURVIVAL_FACTOR[agentId] : base;
  return Math.round(raw * 100) / 100;
}

function adjustPriority(priority: Suggestion['priority'], weight: number): Suggestion['priority'] {
  if (weight >= LIFT_AT) return Math.max(1, priority - 1) as Suggestion['priority'];
  if (weight <= DEMOTE_AT) return Math.min(3, priority + 1) as Suggestion['priority'];
  return priority;
}

export interface WeightRow {
  agentId: AgentId;
  base: number;
  effective: number;
  count: number;
  moved: number;
}

export interface WeightResult {
  suggestions: Suggestion[];
  rows: WeightRow[];
}

/** 建议归属：先按 sourceFindingIds 找回 finding 的产出 Agent，取不到就归给日程 */
function ownerMap(results: AgentResult[]): Map<string, AgentId> {
  const owner = new Map<string, AgentId>();
  for (const r of results) for (const f of r.findings) owner.set(f.id, r.agentId);
  return owner;
}

export function applyAgentWeights(
  suggestions: Suggestion[],
  results: AgentResult[],
  agents: AgentModule[],
  mode: Mode,
): WeightResult {
  const owner = ownerMap(results);
  const baseOf = new Map<AgentId, number>(agents.map((a) => [a.id, a.defaultWeight]));
  const rows = new Map<AgentId, WeightRow>();

  const weighted = suggestions.map((s) => {
    const agentId = s.sourceFindingIds.map((id) => owner.get(id)).find((x): x is AgentId => Boolean(x)) ?? 'schedule';
    const base = baseOf.get(agentId) ?? 1;
    const effective = effectiveWeight(base, mode, agentId);
    const priority = mode === 'exam' ? adjustPriority(s.priority, effective) : s.priority;

    const row = rows.get(agentId) ?? { agentId, base, effective, count: 0, moved: 0 };
    row.count += 1;
    if (priority !== s.priority) row.moved += 1;
    rows.set(agentId, row);

    return priority === s.priority ? s : { ...s, priority };
  });

  // 排序：优先级 → 有效权重降序 → 稳定保持原顺序
  const weightOf = (s: Suggestion) => {
    const agentId = s.sourceFindingIds.map((id) => owner.get(id)).find((x): x is AgentId => Boolean(x)) ?? 'schedule';
    return rows.get(agentId)?.effective ?? 1;
  };
  const sorted = weighted
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.priority - b.s.priority || weightOf(b.s) - weightOf(a.s) || a.i - b.i)
    .map((x) => x.s);

  return { suggestions: sorted, rows: [...rows.values()].filter((r) => r.count > 0) };
}
