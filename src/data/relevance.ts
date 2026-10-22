import { db } from '@/data/store/db';
import type { AgentContext, RawItem } from '@/types/contract';

/**
 * 信息流相关性打分（dev-tasks A7）
 *
 * 现状：queryAdapters() 只做「硬过滤」（校区 / 受众标签不匹配就整条丢掉），
 * 于是同一身份下所有条目平级、顺序靠数组顺序——「为什么推给我」无从解释。
 *
 * 这里改成「硬过滤 + 软打分 + 可解释理由」：
 *   score = 身份精确度 + 校区 + 与你的课表有关 + 与你最近点选的主题有关 + 信息类型权重
 * 每条命中都产出一句 reasons，直接渲染在卡片上的「为什么推给我」，不做黑箱。
 * 「与我无关」的条目在打分前就被剔除（负反馈不降权，而是直接消失——用户预期更直白）；
 * 若要「同类沉底」而非整条消失，把 muted 判定从 return null 改成 score - 100 即可（见行内注释）。
 */

export interface InterestProfile {
  /** topic → 点选次数（来自 db.choices，A6 之前就有的轻闭环数据） */
  topics: Map<string, number>;
  /** 你本周的课程名，用来判断一条通知是否「和你的课有关」 */
  courseNames: string[];
}

export interface ScoredItem {
  item: RawItem;
  score: number;
  /** 「为什么推给我」的逐条依据，UI 直接渲染 */
  reasons: string[];
}

/** 类型权重：教务 / 快递这类「有时效、漏了就亏」的信息天然更该靠前 */
const TYPE_WEIGHT: Record<string, number> = {
  notice: 1.2,
  express: 1.2,
  'canteen-window': 0.6,
  convenience: 0.4,
};

export async function loadInterests(): Promise<InterestProfile> {
  const [choices, courses] = await Promise.all([db.choices.toArray(), db.courses.toArray()]);
  const topics = new Map<string, number>();
  for (const c of choices) topics.set(c.topic, (topics.get(c.topic) ?? 0) + 1);
  return { topics, courseNames: courses.map((c) => c.name).filter(Boolean) };
}

/** 单条打分；返回 null 表示被负反馈过滤掉 */
export function scoreItem(
  item: RawItem,
  ctx: AgentContext,
  interest: InterestProfile,
  muted: Set<string>,
): ScoredItem | null {
  if (muted.has(item.id)) return null;
  // 若想改成「同类沉底而非消失」：去掉上面的 return，改为 score -= 100 并保留 reasons 里的说明

  const { level, grade, college, campus } = ctx.user.identity;
  const reasons: string[] = [];
  let score = 0;

  if (item.audience && item.audience.length > 0) {
    if (item.audience.includes(grade)) {
      score += 3;
      reasons.push(`定向到 ${grade}`);
    }
    if (item.audience.includes(college)) {
      score += 2.5;
      reasons.push(`定向到 ${college}`);
    }
    if (item.audience.includes(level)) {
      score += 1.5;
      reasons.push(level === 'undergrad' ? '本科生相关' : '研究生相关');
    }
  }

  if (item.campus && item.campus !== 'both') {
    if (item.campus === campus) {
      score += 1.5;
      reasons.push(`就在 ${campus === 'guizishan' ? '桂子山' : '南湖'} 校区`);
    }
  } else if (item.campus === 'both') {
    score += 0.5;
  }

  const text = `${item.title} ${item.body ?? ''}`;
  const hitCourse = interest.courseNames.find((name) => name.length >= 2 && text.includes(name));
  if (hitCourse) {
    score += 2;
    reasons.push(`涉及你的课程「${hitCourse}」`);
  }

  const tagHits = item.tags.filter((tag) => (interest.topics.get(tag) ?? 0) > 0).slice(0, 2);
  for (const tag of tagHits) {
    score += 1;
    reasons.push(`你最近点选过「${tag}」相关建议`);
  }

  score += TYPE_WEIGHT[item.type] ?? 0.5;

  if (reasons.length === 0) reasons.push('校园公共信息（与你的身份无特别关联）');

  return { item, score, reasons };
}

/** 批量打分 + 排序；同分时保持原始顺序，避免每次刷新跳动 */
export function rankFeed(
  items: RawItem[],
  ctx: AgentContext,
  interest: InterestProfile,
  muted: Set<string>,
): ScoredItem[] {
  return items
    .map((item, index) => ({ scored: scoreItem(item, ctx, interest, muted), index }))
    .filter((x): x is { scored: ScoredItem; index: number } => x.scored !== null)
    .sort((a, b) => b.scored.score - a.scored.score || a.index - b.index)
    .map((x) => x.scored);
}
