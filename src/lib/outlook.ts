import { courseOccursOn, mondayOf, toDateKey } from '@/lib/weeks';
import type { Course, ExamItem, SleepLog } from '@/types/contract';

/**
 * 预报与总结的纯计算层
 *
 * 只做「把本地数据折成几组数字」，不碰 React、不碰网络，方便单独验证：
 *   - 未来两天：每天上什么课、有什么 DDL
 *   - 下周：一周的课程量分布 + 下周的考试
 *   - 上周总结：上了多少课、复习完成率、睡眠、遵从度
 */

const DAY_MS = 86_400_000;
const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function weekdayLabel(d: Date): string {
  const i = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return WEEK_CN[i];
}

export function shortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export interface DayPlan {
  date: Date;
  courses: Course[];
  exams: ExamItem[];
  /** 当天最早的课 */
  firstClass?: Course;
  /** 课程总时长（分钟） */
  minutes: number;
}

/** 某天的课与截止项 */
export function planForDate(
  date: Date,
  courses: Course[],
  exams: ExamItem[],
  semesterStart?: string,
): DayPlan {
  const dayCourses = courses
    .filter((c) => courseOccursOn(c, date, semesterStart))
    .sort((a, b) => a.startMin - b.startMin);
  const key = toDateKey(date);
  const dayExams = exams.filter((e) => toDateKey(new Date(e.at)) === key);
  const minutes = dayCourses.reduce((sum, c) => sum + (c.endMin - c.startMin), 0);
  return {
    date,
    courses: dayCourses,
    exams: dayExams,
    firstClass: dayCourses[0],
    minutes,
  };
}

/** 明天、后天 */
export function twoDayForecast(
  now: Date,
  courses: Course[],
  exams: ExamItem[],
  semesterStart?: string,
): DayPlan[] {
  const today = startOfToday(now);
  return [1, 2].map((n) => planForDate(addDays(today, n), courses, exams, semesterStart));
}

export interface WeekForecast {
  monday: Date;
  days: DayPlan[];
  /** 7 天里的课次总数 */
  courseCount: number;
  /** 课最多的一天 */
  busiest: DayPlan | null;
  /** 下周内的考试 / DDL */
  exams: ExamItem[];
}

function weekOf(monday: Date, courses: Course[], exams: ExamItem[], semesterStart?: string): DayPlan[] {
  return Array.from({ length: 7 }, (_, i) => planForDate(addDays(monday, i), courses, exams, semesterStart));
}

/** 下一周（下周一算起）的课表分布 */
export function nextWeekForecast(
  now: Date,
  courses: Course[],
  exams: ExamItem[],
  semesterStart?: string,
): WeekForecast {
  const monday = addDays(mondayOf(now), 7);
  const days = weekOf(monday, courses, exams, semesterStart);
  const courseCount = days.reduce((s, d) => s + d.courses.length, 0);
  const busiest = days.reduce<DayPlan | null>(
    (best, d) => (!best || d.courses.length > best.courses.length ? d : best),
    null,
  );
  const end = addDays(monday, 7).getTime();
  return {
    monday,
    days,
    courseCount,
    busiest: busiest && busiest.courses.length > 0 ? busiest : null,
    exams: exams
      .filter((e) => {
        const t = new Date(e.at).getTime();
        return t >= monday.getTime() && t < end;
      })
      .sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export interface WeekSummary {
  /** 本周一 */
  monday: Date;
  courseCount: number;
  courseMinutes: number;
  reviewPlanned: number;
  reviewDone: number;
  sleepAvg: number | null;
  sleepNights: number;
  /** 周内最缺觉的一晚 */
  worstNight: SleepLog | null;
  complianceDone: number;
  complianceTotal: number;
  /** 本周错过/临近的下一个考试或 DDL */
  upcoming: ExamItem | null;
}

/** 本周（周一起算到现在）的总结 */
export function weekSummary(
  now: Date,
  courses: Course[],
  exams: ExamItem[],
  sleeps: SleepLog[],
  blocks: { date: string; done: boolean }[],
  compliance: { date: string; done: boolean }[],
  semesterStart?: string,
): WeekSummary {
  const monday = mondayOf(now);
  const days = weekOf(monday, courses, exams, semesterStart);
  const keys = new Set(days.map((d) => toDateKey(d.date)));

  const weekSleeps = sleeps.filter((s) => keys.has(s.date));
  const sleepAvg = weekSleeps.length
    ? Math.round((weekSleeps.reduce((s, x) => s + x.hours, 0) / weekSleeps.length) * 10) / 10
    : null;
  const worstNight = weekSleeps.length
    ? weekSleeps.reduce((worst, s) => (s.hours < worst.hours ? s : worst), weekSleeps[0])
    : null;

  const weekBlocks = blocks.filter((b) => keys.has(b.date));
  const weekCompliance = compliance.filter((c) => keys.has(c.date));

  const upcoming = exams
    .filter((e) => new Date(e.at).getTime() >= startOfToday(now).getTime())
    .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;

  return {
    monday,
    courseCount: days.reduce((s, d) => s + d.courses.length, 0),
    courseMinutes: days.reduce((s, d) => s + d.minutes, 0),
    reviewPlanned: weekBlocks.length,
    reviewDone: weekBlocks.filter((b) => b.done).length,
    sleepAvg,
    sleepNights: weekSleeps.length,
    worstNight,
    complianceDone: weekCompliance.filter((c) => c.done).length,
    complianceTotal: weekCompliance.length,
    upcoming,
  };
}

export function daysUntil(iso: string, now: Date): number {
  const target = new Date(iso);
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d1 = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((d1 - d0) / DAY_MS);
}

export function fmtHour(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
