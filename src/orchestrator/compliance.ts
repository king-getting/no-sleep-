import { db } from '@/data/store/db';
import type { Suggestion } from '@/types/contract';

/**
 * 遵从度回流（A8）
 *
 * 原始版本只服务一处：健康 Agent 里「午间小憩」连续两次没做就换成 10 分钟轻量版。
 * 那次的判断读的是 preferences.compliance 的累计值（shown/done），
 * 既区分不出「连续」和「隔三差五」，也管不到别的主题。
 *
 * 这里把它做成通用的一层：
 * - 真正的「连续没做」由 db.compliance 的按日执行记录算（同一天只记最后一次点击）
 * - 连续 missStreak >= 2 次 → 第三轮同一主题的建议**降一级**（1 最高 → 3 最低）
 * - 晚报的「本周执行率」也从同一份数据里出，不另存一份统计
 */

/** 连续没做几次之后开始降级 */
export const MISSES_BEFORE_DOWNGRADE = 2;

export interface TopicStat {
  topic: string;
  /** 追问过的天数（按日期去重，同一天点两次只算一次） */
  shown: number;
  /** 其中标了「做了」的天数 */
  done: number;
  /** 最近连续「没做」的天数 */
  missStreak: number;
}

export interface ComplianceDowngrade {
  topic: string;
  from: Suggestion['priority'];
  to: Suggestion['priority'];
  missStreak: number;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 把 compliance 表聚合成「每个主题一条」的执行画像 */
export async function collectTopicStats(): Promise<Map<string, TopicStat>> {
  const records = await db.compliance.toArray();
  const byTopic = new Map<string, Map<string, boolean>>();

  for (const r of records) {
    const days = byTopic.get(r.topic) ?? new Map<string, boolean>();
    // 同一天可能点多次：以最后一次为准
    days.set(r.date, r.done);
    byTopic.set(r.topic, days);
  }

  const stats = new Map<string, TopicStat>();
  for (const [topic, days] of byTopic) {
    const dates = [...days.keys()].sort();
    let done = 0;
    for (const d of dates) if (days.get(d)) done += 1;

    let missStreak = 0;
    for (let i = dates.length - 1; i >= 0; i -= 1) {
      if (days.get(dates[i])) break;
      missStreak += 1;
    }

    stats.set(topic, { topic, shown: dates.length, done, missStreak });
  }
  return stats;
}

/**
 * 连续没做的主题，本轮建议降一级。
 * 1 → 2 → 3（数字越大越靠后），已经是 3 的不再动。
 */
export function downgradeByCompliance(
  suggestions: Suggestion[],
  stats: Map<string, TopicStat>,
): { suggestions: Suggestion[]; downgraded: ComplianceDowngrade[] } {
  const downgraded: ComplianceDowngrade[] = [];

  const next = suggestions.map((s) => {
    const stat = stats.get(s.topic);
    if (!stat || stat.missStreak < MISSES_BEFORE_DOWNGRADE) return s;
    if (s.priority >= 3) return s;

    const to = (s.priority + 1) as Suggestion['priority'];
    downgraded.push({ topic: s.topic, from: s.priority, to, missStreak: stat.missStreak });
    return { ...s, priority: to };
  });

  return { suggestions: next, downgraded };
}

/**
 * 晚报「本周执行率」文案：只看最近 7 天，没有记录就返回 null（不编数字）。
 */
export async function weeklyComplianceText(now: Date): Promise<string | null> {
  const records = await db.compliance.toArray();
  if (records.length === 0) return null;

  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  const fromKey = dateKey(from);

  const recent = records.filter((r) => r.date >= fromKey);
  if (recent.length === 0) return null;

  const days = new Map<string, boolean>();
  for (const r of recent) days.set(`${r.date}|${r.topic}`, r.done);

  const total = days.size;
  const done = [...days.values()].filter(Boolean).length;
  const rate = Math.round((done / total) * 100);
  return `${done} / ${total} 次（${rate}%）`;
}
