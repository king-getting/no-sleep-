import type { Course } from '@/types/contract';

/**
 * 教学周：解析、格式化、日期换算
 *
 * 课表里「1-14周」「1,3,5…17周」「2-16双周」这类写法统一折成周号数组。
 * 没有周号 = 每周都上（老数据、手加的课默认这样）。
 */

export interface WeekParse {
  weeks?: number[];
  error?: string;
}

/** '1-14' / '1,3,5' / '1-16单' / '2-16双' / '每周' / '' → 周号数组 */
export function parseWeeks(text: string): WeekParse {
  const raw = text.trim();
  if (!raw) return { weeks: undefined };
  if (/^(每)?周$|全部|全学期|每周/.test(raw)) return { weeks: undefined };

  const tokens = raw
    .replace(/\s/g, '')
    .split(/[,，、;；]+/)
    .filter(Boolean);
  const set = new Set<number>();

  for (const token of tokens) {
    const parity = token.includes('单') ? 'odd' : token.includes('双') ? 'even' : null;
    const body = token.replace(/[单双]/g, '').replace(/周/g, '');
    const range = body.match(/^(\d{1,2})\s*[-–—~至]\s*(\d{1,2})$/);
    const single = body.match(/^(\d{1,2})$/);

    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > 30 || from > to) return { error: `「${token}」这个周次范围不合法` };
      for (let w = from; w <= to; w += 1) {
        if (parity === 'odd' && w % 2 === 0) continue;
        if (parity === 'even' && w % 2 === 1) continue;
        set.add(w);
      }
      continue;
    }
    if (single) {
      const w = Number(single[1]);
      if (w < 1 || w > 30) return { error: `第 ${w} 周超出范围（1–30）` };
      set.add(w);
      continue;
    }
    return { error: `「${token}」认不出来，写 1-16 或 1,3,5 或 2-16双` };
  }

  if (set.size === 0) return { error: '没有解析出任何一周' };
  return { weeks: [...set].sort((a, b) => a - b) };
}

/** 周号数组 → 紧凑写法：1-16 / 1-17 单周 / 2-16 双周 / 1,3,7 */
export function formatWeeks(weeks?: number[]): string {
  if (!weeks || weeks.length === 0) return '每周';
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last - first + 1;

  if (sorted.length === span) return first === last ? `第 ${first} 周` : `${first}-${last} 周`;

  // 等差 2：单周 / 双周
  if (sorted.length > 2 && sorted.every((w, i) => i === 0 || w - sorted[i - 1] === 2)) {
    return `${first}-${last} ${first % 2 === 1 ? '单' : '双'}周`;
  }
  return sorted.map((w) => `${w}`).join(',') + ' 周';
}

/** 该日期所在周的周一（00:00） */
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return d;
}

export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

const DAY_MS = 86_400_000;

/** 某天是教学第几周；学期没设置或早于开学返回 null */
export function weekOfDate(date: Date, semesterStart?: string): number | null {
  if (!semesterStart) return null;
  const start = mondayOf(fromDateKey(semesterStart));
  const target = mondayOf(date);
  const diff = Math.floor((target.getTime() - start.getTime()) / DAY_MS);
  const week = Math.floor(diff / 7) + 1;
  return week >= 1 && week <= 30 ? week : null;
}

/** 第 N 周某天对应的日期 */
export function dateOfWeekDay(week: number, dow: 1 | 2 | 3 | 4 | 5 | 6 | 7, semesterStart: string): Date {
  const start = mondayOf(fromDateKey(semesterStart));
  const d = new Date(start);
  d.setDate(start.getDate() + (week - 1) * 7 + (dow - 1));
  return d;
}

/** 这门课在指定日期上不上（星期匹配 + 周次匹配） */
export function courseOccursOn(course: Course, date: Date, semesterStart?: string): boolean {
  const dow = date.getDay() === 0 ? 7 : date.getDay();
  if (dow !== course.dayOfWeek) return false;
  // 没设学期：不知道第几周，只能全部显示
  if (!semesterStart) return true;
  const week = weekOfDate(date, semesterStart);
  // 学期外（开学前、放假后）一律不上课
  if (week === null) return false;
  if (!course.weeks || course.weeks.length === 0) return true;
  return course.weeks.includes(week);
}

/** 周号数组 → 可编辑的输入文本（1-16 / 1-17 单 / 空 = 每周） */
export function weeksToInput(weeks?: number[]): string {
  if (!weeks || weeks.length === 0) return '';
  return formatWeeks(weeks)
    .replace(/^第\s*/, '')
    .replace(/\s*周$/, '');
}

/** 默认学期开始：秋季 9 月 1 日（往前推到周一），春季 2 月 24 日 */
/**
 * 有效学期起点：用户没设就用默认推算（秋季 9/1 那周的周一，春季 2/24 那周）。
 *
 * 为什么要兜底：courseOccursOn 在 semesterStart 为空时会「全部返回 true」，
 * 于是周次过滤整个失效——导入一份 1–8 周的课表，到了第 10 周报告还照算。
 * 宁可按默认周次算错一两周，也不要完全不按周次算。
 */
export function effectiveSemesterStart(semesterStart?: string, today = new Date()): string {
  return semesterStart || defaultSemesterStart(today);
}

export function defaultSemesterStart(today = new Date()): string {
  const year = today.getFullYear();
  const autumn = today.getMonth() + 1 >= 8;
  const seed = new Date(autumn ? year : year - 1, autumn ? 8 : 1, autumn ? 1 : 24);
  return toDateKey(mondayOf(seed));
}
