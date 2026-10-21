import type { ConflictCard, ConflictClaim, Preferences, Suggestion } from '@/types/contract';

/**
 * 冲突仲裁器（设计文档 §5.3）
 * 原则：冲突不消灭，显性化；仲裁权归用户；但只把「真冲突」交给用户。
 *
 * 合并/裁决优先级（从高到低）：
 * 1. 硬约束：上课时间、考试——不可违背
 * 2. 安全红线：连续多日严重缺觉等健康预警——自动升级
 * 3. 用户历史选择（本地偏好画像）
 * 4. 时间/空间可行性（顺路、来得及）
 * 5. Agent 默认权重
 */

/** L2 真冲突：同一 topic 上出现两方及以上主张 → 生成冲突卡，用户拍板 */
export function arbitrateClaims(claims: ConflictClaim[], prefs: Preferences): ConflictCard[] {
  const byTopic = new Map<string, ConflictClaim[]>();
  for (const c of claims) {
    const list = byTopic.get(c.topic) ?? [];
    list.push(c);
    byTopic.set(c.topic, list);
  }

  const cards: ConflictCard[] = [];
  for (const [topic, list] of byTopic) {
    const sides = new Set(list.map((c) => c.side));
    if (sides.size < 2) continue; // 单方主张不构成冲突，总控可直接采纳
    cards.push({
      id: `conflict-${topic}`,
      topic,
      level: 'L2',
      planA: list[0].plan,
      planB: list[1].plan,
      // 裁决记忆：同类冲突上次选过 → 预填，仍可一键切换（裁决一次，不再重复打扰）
      preset: prefs.conflictChoices[topic] !== undefined,
    });
  }
  return cards;
}

/**
 * L1 可调和冲突：总控按时间/空间可行性自动合并，不打扰用户。
 * 当前规则：午间「取快递」（生活）×「小憩」（健康）同窗口 → 合并成一条时间线。
 */
export function mergeSuggestions(suggestions: Suggestion[]): { suggestions: Suggestion[]; merges: string[] } {
  const nap = suggestions.find((s) => s.topic === '午间小憩');
  const errand = suggestions.find((s) => s.topic === '取快递');
  if (!nap || !errand) return { suggestions, merges: [] };

  const merged: Suggestion = {
    id: 'sug-noon-merged',
    topic: '午后空档安排',
    priority: 2,
    slot: 'noon',
    sourceFindingIds: [...nap.sourceFindingIds, ...errand.sourceFindingIds],
    options: [
      {
        id: 'merged-a',
        title: '先取快递（顺路），回来眯 15 分钟',
        cost: { timeMin: 25 },
        pros: ['两件事都办了', '顺路，不单独跑一趟'],
        cons: ['小憩缩短到 15 分钟'],
        impacts: [
          { horizon: 'short', text: '下午犯困概率降低，快递也不会忘', agentId: 'life' },
        ],
        evidences: [...(nap.options[0]?.evidences ?? []), ...(errand.options[0]?.evidences ?? [])],
      },
      nap.options[0],
      errand.options[0],
    ].filter(Boolean) as Suggestion['options'],
  };

  return {
    suggestions: suggestions.filter((s) => s !== nap && s !== errand).concat(merged),
    merges: ['L1 自动合并：生活「取快递」× 健康「午间小憩」→ 一条时间线：先取快递（顺路），回来眯 15 分钟'],
  };
}
