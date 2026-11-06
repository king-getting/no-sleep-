import type { DirectionId, DirectionResult, Evidence, Suggestion } from '@/types/contract';

/**
 * 依据富化（契约 §5.1「汇总」职责的实现）
 *
 * 原则：专职 方向 只访问自己域的数据；一张选项卡若需要其他域的依据
 * （如「轻食」选项需要健康 方向 的睡眠评估），由编排器在汇总阶段
 * 把对应 Finding 挂载到选项卡上，方向 之间不越域读数据。
 *
 * 新增富化规则 = 在 RULES 加一行。
 */

interface EnrichmentRule {
  /** 目标建议的 topic */
  suggestionTopic: string;
  /** 目标选项卡 id */
  optionId: string;
  /** 依据来源：某 方向 在某 topic 上的 Finding */
  from: { directionId: DirectionId; topic: string };
  /** 依据措辞加工：输入 Finding.summary，输出展示文本 */
  render?: (summary: string) => string;
}

const RULES: EnrichmentRule[] = [
  {
    // §5.2：轻食选项挂健康依据——缺觉时清淡饮食午后不犯困
    suggestionTopic: '午饭吃什么',
    optionId: 'lunch-b',
    from: { directionId: 'health', topic: '睡眠' },
    render: (s) => `${s}——睡眠负债下，清淡饮食午后更不犯困`,
  },
  {
    // §5.2：便利店选项挂日程依据——碎片时间可用来预习
    suggestionTopic: '午饭吃什么',
    optionId: 'lunch-c',
    from: { directionId: 'schedule', topic: '时间块' },
    render: (s) => `今日时间块：${s}——省下的时间可用于课前预习`,
  },
];

export function enrichSuggestions(suggestions: Suggestion[], results: DirectionResult[]): Suggestion[] {
  if (RULES.length === 0) return suggestions;
  return suggestions.map((suggestion) => {
    const options = suggestion.options.map((option) => {
      const rule = RULES.find((r) => r.suggestionTopic === suggestion.topic && r.optionId === option.id);
      if (!rule) return option;
      const finding = results
        .find((r) => r.directionId === rule.from.directionId)
        ?.findings.find((f) => f.topic === rule.from.topic);
      if (!finding) return option;
      // 该方依据已存在则不重复挂载
      if (option.evidences.some((e) => e.directionId === rule.from.directionId)) return option;
      const evidence: Evidence = {
        directionId: rule.from.directionId,
        text: rule.render ? rule.render(finding.summary) : finding.summary,
        confidence: finding.confidence,
      };
      return { ...option, evidences: [...option.evidences, evidence] };
    });
    return { ...suggestion, options };
  });
}
