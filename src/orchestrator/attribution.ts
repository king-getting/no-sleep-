import type { AgentId, OptionCard, Suggestion } from '@/types/contract';
import type { TopicStat } from './compliance';
import { MISSES_BEFORE_DOWNGRADE } from './compliance';

/**
 * 归因回流（设计文档 §4.7「问为什么，不问怎么办」）
 *
 * 晚间点「没做」时用户选了原因（起晚了/不饿/没时间/忘了），原因存在本地偏好里；
 * 第二天晨间报告组装前，这里把「昨天的原因」翻译成一张更轻的选项卡插进对应建议——
 * 用户感知是「它在帮我扫清障碍」，而不是「它在记录我的失败」。
 *
 * 规则表是纯粹的 topic + reason → 选项卡映射；没有命中规则时给一个通用轻量版，
 * 保证任何主题的归因都有回应，不出现「问了白问」。
 */

interface AttributedOption {
  title: string;
  cost: OptionCard['cost'];
  pros: string[];
  cons: string[];
  impacts: { horizon: 'short' | 'long'; text: string; agentId: AgentId }[];
}

function agentOf(s: Suggestion): AgentId {
  return s.options[0]?.evidences[0]?.agentId ?? 'schedule';
}

/** topic + 归因 → 更轻的选项卡（null = 走通用兜底） */
const RULES: Record<string, Record<string, AttributedOption>> = {
  早餐吃什么: {
    起晚了: {
      title: '前一晚床头备面包 + 酸奶',
      cost: { money: 5, timeMin: 2 },
      pros: ['起床后两分钟解决，不占洗漱时间', '前一晚顺手放好，不考验早上的你'],
      cons: ['需要前一晚备好，当天开始用不了'],
      impacts: [{ horizon: 'short', text: '早八不空腹，前两节课不掉状态', agentId: 'health' }],
    },
    不饿: {
      title: '打包带走，上午十点再吃',
      cost: { money: 5, timeMin: 0 },
      pros: ['不强迫没胃口的早上进食', '十点血糖低点正好补上'],
      cons: ['十点前有点饿只能忍一小会儿'],
      impacts: [{ horizon: 'short', text: '比完全不吃稳，比硬吃舒服', agentId: 'health' }],
    },
  },
  午间小憩: {
    没时间: {
      title: '闭眼 3 分钟也算数',
      cost: { timeMin: 3 },
      pros: ['不用睡着，闭眼就算恢复', '任何碎片时间塞得下'],
      cons: ['恢复有限，只适合救急'],
      impacts: [{ horizon: 'short', text: '下午第一节的犯困概率降一点是一点', agentId: 'health' }],
    },
  },
};

/** 连续没做 ≥2 次时附带的「调小计划」卡（§4.7 行为设计：用最小可行版本保住完成感） */
function shrinkPlanOption(s: Suggestion, streak: number): AttributedOption {
  return {
    title: `缩小范围：只在最有需要的那天做`,
    cost: { timeMin: s.options[0]?.cost.timeMin },
    pros: [`连续 ${streak} 次没做成，可能是计划定大了`, '范围砍半，完成感先回来'],
    cons: ['覆盖面变小，靠别的日子补'],
    impacts: [{ horizon: 'long', text: '完成感回来了，计划才留得下来', agentId: 'schedule' }],
  };
}

function toOptionCard(s: Suggestion, body: AttributedOption, tag: string): OptionCard {
  return {
    id: `${s.id}-miss-${tag}`,
    title: body.title,
    cost: body.cost,
    pros: body.pros,
    cons: body.cons,
    impacts: body.impacts,
    evidences: [
      {
        agentId: agentOf(s),
        text: `昨天你没做成，选的原因是「${tag}」——这张卡是为这个原因准备的更轻版本`,
        confidence: 2,
      },
    ],
  };
}

/**
 * 把「没做归因」翻译成晨间报告的额外选项卡。
 * 只在晨间报告调用；每个命中的主题最多插两张（归因卡 + 连续未执行的缩小计划卡）。
 */
export function applyMissReasons(
  suggestions: Suggestion[],
  missReasons: Record<string, string> | undefined,
  stats: Map<string, TopicStat>,
): { suggestions: Suggestion[]; notes: string[] } {
  if (!missReasons) return { suggestions, notes: [] };

  const notes: string[] = [];
  const next = suggestions.map((s) => {
    const reason = missReasons[s.topic];
    const extra: OptionCard[] = [];

    if (reason) {
      const ruled = RULES[s.topic]?.[reason];
      const body: AttributedOption =
        ruled ?? {
          title: '换个更轻的版本再试一次',
          cost: { timeMin: Math.max(5, Math.round((s.options[0]?.cost.timeMin ?? 20) / 3)) },
          pros: ['成本砍到原来的三分之一', '先让「做过」发生，再谈做好'],
          cons: ['效果打折，只适合过渡'],
          impacts: [{ horizon: 'long', text: '小步走比反复失败更容易坚持', agentId: agentOf(s) }],
        };
      extra.push(toOptionCard(s, body, reason));
      notes.push(`归因回流：昨天「${s.topic}」没做（${reason}）→ 已插入更轻的选项`);
    }

    const streak = stats.get(s.topic)?.missStreak ?? 0;
    if (streak >= MISSES_BEFORE_DOWNGRADE + 1 && !extra.some((o) => o.title.startsWith('缩小范围'))) {
      extra.push(toOptionCard(s, shrinkPlanOption(s, streak), '缩小计划'));
      notes.push(`连续 ${streak} 次没做：为「${s.topic}」附了一张「缩小计划」卡`);
    }

    return extra.length > 0 ? { ...s, options: [...s.options, ...extra] } : s;
  });

  return { suggestions: next, notes };
}
