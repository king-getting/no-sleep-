import { MOCK_COURSES, buildMockExams } from '@/data/mock/courses';
import { dayOfWeek, fmtMin } from '@/types/contract';
import type { Course, ExamItem, SleepLog, TimeBlock } from '@/types/contract';

/**
 * 领域查询：Agent 与报告组装共用的只读查询。
 * 课表当前来自 mock 模块（等价于「已导入的课表 JSON」），落库后只改这里。
 */

export function todayCourses(now: Date): Course[] {
  const dow = dayOfWeek(now);
  return MOCK_COURSES.filter((c) => c.dayOfWeek === dow).sort((a, b) => a.startMin - b.startMin);
}

export function coursesOfDay(dow: 1 | 2 | 3 | 4 | 5 | 6 | 7): Course[] {
  return MOCK_COURSES.filter((c) => c.dayOfWeek === dow).sort((a, b) => a.startMin - b.startMin);
}

/** 时间块切分：上课 / 整块空档（≥120min） / 碎片（<120min） */
export function computeTimeBlocks(courses: Course[], dayStart = 7 * 60, dayEnd = 23 * 60): TimeBlock[] {
  const blocks: TimeBlock[] = [];
  let cursor = dayStart;
  for (const c of courses) {
    if (c.startMin > cursor) {
      blocks.push({
        kind: c.startMin - cursor >= 120 ? 'free' : 'fragment',
        startMin: cursor,
        endMin: c.startMin,
      });
    }
    blocks.push({ kind: 'class', startMin: c.startMin, endMin: c.endMin, label: c.name });
    cursor = Math.max(cursor, c.endMin);
  }
  if (cursor < dayEnd) {
    blocks.push({
      kind: dayEnd - cursor >= 120 ? 'free' : 'fragment',
      startMin: cursor,
      endMin: dayEnd,
    });
  }
  return blocks;
}

export function upcomingExams(now: Date, withinDays = 14): ExamItem[] {
  const horizon = now.getTime() + withinDays * 24 * 3600_000;
  return buildMockExams(now)
    .filter((e) => new Date(e.at).getTime() <= horizon)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** 早八：8:00 及以前开始上课 */
export function hasEarlyEight(courses: Course[]): boolean {
  return courses.some((c) => c.startMin <= 480);
}

/** 连排：相邻两节课间隙 ≤15 分钟 */
export function hasBackToBack(courses: Course[]): boolean {
  for (let i = 1; i < courses.length; i++) {
    if (courses[i].startMin - courses[i - 1].endMin <= 15) return true;
  }
  return false;
}

/** 午休被吃掉：课程与 11:30–13:00 重叠 ≥45 分钟 */
export function lunchCrunch(courses: Course[]): Course | undefined {
  return courses.find((c) => Math.min(c.endMin, 780) - Math.max(c.startMin, 690) >= 45);
}

export function lastNightSleep(logs: SleepLog[]): SleepLog | undefined {
  return logs.at(-1);
}

export function avgSleepHours(logs: SleepLog[], lastN: number): number {
  const slice = logs.slice(-lastN);
  if (slice.length === 0) return 8; // 无数据按健康基线，不误报
  return slice.reduce((s, l) => s + l.hours, 0) / slice.length;
}

const MIN_BLOCK_MIN = 120;

function blockDate(base: Date, dayOffset: number, min: number): Date {
  const d = new Date(base);
  d.setDate(base.getDate() + dayOffset);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
}

/** 从 now 起算、截止 deadline 之前，是否还有 ≥2h 的整块空档（看今明两天） */
export function hasFreeBlockBefore(now: Date, deadline: Date): boolean {
  const dow = dayOfWeek(now);
  for (const offset of [0, 1]) {
    const d = ((((dow - 1 + offset) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
    for (const b of computeTimeBlocks(coursesOfDay(d))) {
      if (b.kind !== 'free') continue;
      const start = blockDate(now, offset, b.startMin);
      const end = blockDate(now, offset, b.endMin);
      // 今天已过去的时段不算数
      const effectiveStart = offset === 0 && start < now ? now : start;
      if (end <= effectiveStart) continue;
      if (end.getTime() - effectiveStart.getTime() < MIN_BLOCK_MIN * 60_000) continue;
      if (effectiveStart.getTime() < deadline.getTime()) return true;
    }
  }
  return false;
}

/** 今晚（18:00–23:00）是否存在可争夺的整块空档（≥2h，从 now 起算） */
export function tonightFreeBlock(now: Date): TimeBlock | undefined {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return computeTimeBlocks(todayCourses(now)).find(
    (b) => b.kind === 'free' && Math.min(b.endMin, 23 * 60) - Math.max(b.startMin, nowMin, 18 * 60) >= MIN_BLOCK_MIN,
  );
}

export function describeBlocks(blocks: TimeBlock[]): string {
  const free = blocks.filter((b) => b.kind === 'free');
  const frag = blocks.filter((b) => b.kind === 'fragment');
  const parts: string[] = [];
  if (free.length > 0) parts.push(`整块空档 ${free.length} 段（${free.map((b) => `${fmtMin(b.startMin)}–${fmtMin(b.endMin)}`).join('、')}）`);
  if (frag.length > 0) parts.push(`碎片 ${frag.length} 段`);
  return parts.length > 0 ? parts.join('；') : '今天没有空档';
}
