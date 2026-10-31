import { db } from '@/data/store/db';
import { ensureSeeded } from '@/data/store/profile';
import { dayOfWeek, fmtMin } from '@/types/contract';
import type { Course, ExamItem, SleepLog, TimeBlock } from '@/types/contract';

/**
 * 领域查询：Agent 与报告组装共用的只读查询。
 * 课表 / 考试存于本地 IndexedDB（A3 起），手动录入与教务 adapter 共用同一存储。
 */

// ── 取数（异步，读库）────────────────────────────────────────

export async function todayCourses(now: Date): Promise<Course[]> {
  return coursesOfDay(dayOfWeek(now));
}

export async function coursesOfDay(dow: 1 | 2 | 3 | 4 | 5 | 6 | 7): Promise<Course[]> {
  await ensureSeeded();
  return db.courses.where('dayOfWeek').equals(dow).sortBy('startMin');
}

export async function upcomingExams(now: Date, withinDays = 14): Promise<ExamItem[]> {
  await ensureSeeded();
  const horizon = now.getTime() + withinDays * 24 * 3600_000;
  return (await db.exams.toArray())
    .filter((e) => new Date(e.at).getTime() <= horizon)
    .sort((a, b) => a.at.localeCompare(b.at));
}

// ── 纯函数（同步，操作已取到的数据）──────────────────────────

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

// ── 睡眠 ─────────────────────────────────────────────────────
// 口径：SleepLog.date 是「入睡日期」。昨晚 = 昨天那一条；
// 断更一天就是没有昨天，不拿更早的记录冒充昨晚。

export function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function lastNightSleep(logs: SleepLog[], now = new Date()): SleepLog | undefined {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = dateKeyOf(yesterday);
  return logs.find((l) => l.date === key);
}

/**
 * 近 N 晚平均睡眠：按日历窗口取「从昨天往前 N 天」，缺记录的日子不计入。
 * 一条记录都没有时返回 null —— 调用方必须说「没有记录」，
 * 不能拿 8h 健康基线当实测值（真实模式第一天就会撞上）。
 */
export function avgSleepHours(logs: SleepLog[], lastN: number, now = new Date()): number | null {
  const byDate = new Map(logs.map((l) => [l.date, l.hours]));
  const values: number[] = [];
  for (let i = 1; i <= lastN; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const hours = byDate.get(dateKeyOf(d));
    if (typeof hours === 'number') values.push(hours);
  }
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 近 N 晚里有几晚有记录：把「平均」和「缺口」一起说清楚，免得平均掩盖断更 */
export function sleepCoverage(logs: SleepLog[], lastN: number, now = new Date()): number {
  const keys = new Set(logs.map((l) => l.date));
  let hit = 0;
  for (let i = 1; i <= lastN; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (keys.has(dateKeyOf(d))) hit += 1;
  }
  return hit;
}

export interface WakePlan {
  /** 起床时刻（当天 0:00 起的分钟数） */
  wakeMin: number;
  reason: 'class' | 'default';
  firstClass?: Course;
  /** 0 = 今天（凌晨还没睡，指今天早上）；1 = 明天 */
  dayOffset: 0 | 1;
}

/**
 * 起床计划：按「下一次要起床的那天」最早的一节课反推（课前 40 分钟），
 * 没课默认 8:30；凌晨 5 点前视为还没睡，指向当天早上。
 * 之前这里硬编码 7:00，没早八的日子「现在睡能睡 X 小时」就是错的。
 */
export async function wakePlanOf(now: Date): Promise<WakePlan> {
  const dayOffset: 0 | 1 = now.getHours() < 5 ? 0 : 1;
  const target = new Date(now);
  target.setDate(target.getDate() + dayOffset);
  const courses = await coursesOfDay(dayOfWeek(target));
  const first = courses[0]; // coursesOfDay 已按 startMin 排序
  if (first) {
    const wakeMin = Math.max(6 * 60, Math.floor((first.startMin - 40) / 5) * 5);
    return { wakeMin, reason: 'class', firstClass: first, dayOffset };
  }
  return { wakeMin: 8 * 60 + 30, reason: 'default', dayOffset };
}

/** 现在就睡、到 wakeMin 起床能睡几小时（自动跨午夜；只在晚上问才有意义） */
export function hoursIfSleepNow(now: Date, wakeMin: number): number {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const diff = wakeMin - nowMin;
  const total = diff > 0 ? diff : diff + 24 * 60;
  return Math.round((total / 60) * 10) / 10;
}

// ── 睡眠债 / 作息规律性 / 本周对比 ───────────────────────────
// 三条都只用「有记录的那几晚」算，并且同时报出覆盖晚数，
// 免得 2 条记录算出来的「欠了 1.4 小时」被当成一周的结论。

/** 每晚需要多少小时：取 7.5，与图表里的建议线同一个数 */
export const SLEEP_NEED_HOURS = 7.5;

export interface SleepDebt {
  /** 累计欠下的小时数（每晚不足 7.5 的部分相加） */
  debtHours: number;
  /** 有记录的晚数 */
  covered: number;
  /** 窗口总共几晚 */
  window: number;
  /** 欠得最多的那一晚 */
  worst?: { date: string; hours: number };
}

export function sleepDebt(logs: SleepLog[], lastN = 7, now = new Date()): SleepDebt | null {
  const byDate = new Map(logs.map((l) => [l.date, l.hours]));
  let debt = 0;
  let covered = 0;
  let worst: SleepDebt['worst'];
  for (let i = 1; i <= lastN; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKeyOf(d);
    const hours = byDate.get(key);
    if (typeof hours !== 'number') continue;
    covered += 1;
    const short = SLEEP_NEED_HOURS - hours;
    if (short > 0) {
      debt += short;
      if (!worst || short > SLEEP_NEED_HOURS - worst.hours) worst = { date: key, hours };
    }
  }
  if (covered === 0) return null;
  return { debtHours: Math.round(debt * 10) / 10, covered, window: lastN, worst };
}

export interface SleepRhythm {
  /** 入睡时间的标准差（分钟）：越小越稳 */
  stdMin: number;
  /** 平均入睡时刻（分钟数，>1440 表示次日凌晨） */
  meanMin: number;
  covered: number;
}

/** 凌晨 0–11 点入睡的统一挪到次日，避免 23:50 和 00:10 被算成「差 23 小时」 */
function normalizeBed(min: number): number {
  return min < 12 * 60 ? min + 24 * 60 : min;
}

export function bedtimeRegularity(logs: SleepLog[], lastN = 7, now = new Date()): SleepRhythm | null {
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const values: number[] = [];
  for (let i = 1; i <= lastN; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const log = byDate.get(dateKeyOf(d));
    if (log && typeof log.bedTimeMin === 'number') values.push(normalizeBed(log.bedTimeMin));
  }
  // 只有一晚谈不上「规律」，两天也算不出有意义的波动
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { stdMin: Math.round(Math.sqrt(variance)), meanMin: Math.round(mean), covered: values.length };
}

export interface WeekCompare {
  thisWeek: number | null;
  lastWeek: number | null;
  /** 本周 − 上周（小时，正数表示这周睡得更多）；两边都有数时才有值 */
  delta: number | null;
}

export function weekOverWeek(logs: SleepLog[], now = new Date()): WeekCompare {
  const avgOf = (from: number, to: number): number | null => {
    const values: number[] = [];
    for (let i = from; i <= to; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const log = logs.find((l) => l.date === dateKeyOf(d));
      if (log) values.push(log.hours);
    }
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  };
  const thisWeek = avgOf(1, 7);
  const lastWeek = avgOf(8, 14);
  const delta =
    thisWeek !== null && lastWeek !== null ? Math.round((thisWeek - lastWeek) * 10) / 10 : null;
  return { thisWeek, lastWeek, delta };
}

export function describeBlocks(blocks: TimeBlock[]): string {
  const free = blocks.filter((b) => b.kind === 'free');
  const frag = blocks.filter((b) => b.kind === 'fragment');
  const parts: string[] = [];
  if (free.length > 0) parts.push(`整块空档 ${free.length} 段（${free.map((b) => `${fmtMin(b.startMin)}–${fmtMin(b.endMin)}`).join('、')}）`);
  if (frag.length > 0) parts.push(`碎片 ${frag.length} 段`);
  return parts.length > 0 ? parts.join('；') : '今天没有空档';
}

// ── 组合查询（异步）──────────────────────────────────────────

const MIN_BLOCK_MIN = 120;

function blockDate(base: Date, dayOffset: number, min: number): Date {
  const d = new Date(base);
  d.setDate(base.getDate() + dayOffset);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
}

/** 从 now 起算、截止 deadline 之前，是否还有 ≥2h 的整块空档（看今明两天） */
export async function hasFreeBlockBefore(now: Date, deadline: Date): Promise<boolean> {
  const dow = dayOfWeek(now);
  for (const offset of [0, 1]) {
    const d = ((((dow - 1 + offset) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
    for (const b of computeTimeBlocks(await coursesOfDay(d))) {
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
export async function tonightFreeBlock(now: Date): Promise<TimeBlock | undefined> {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return computeTimeBlocks(await todayCourses(now)).find(
    (b) => b.kind === 'free' && Math.min(b.endMin, 23 * 60) - Math.max(b.startMin, nowMin, 18 * 60) >= MIN_BLOCK_MIN,
  );
}
