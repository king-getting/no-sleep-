import { courseOccursOn, mondayOf, toDateKey } from '@/lib/weeks';
import type { Course, ExamItem, SleepLog, UserProfile } from '@/types/contract';

/**
 * 事实包（FactBundle）
 *
 * 生成层唯一允许引用的东西。每一条事实都有稳定 id，模型/模板产出的每句话
 * 都必须挂上它引用到的 factIds，渲染前统一校验——引用不存在的直接判失败。
 *
 * 这样「文本里有没有编造」就不再靠字符串匹配，而是靠 id 是否真实存在。
 */

export type FactKind = 'course' | 'exam' | 'sleep' | 'free' | 'review' | 'compliance' | 'week' | 'profile';

export interface Fact {
  id: string;
  kind: FactKind;
  /** 人话描述，用于「依据」展开 */
  label: string;
  at?: string;
}

export interface DayDigest {
  date: string;
  courses: { id: string; name: string; startMin: number; endMin: number; location: string }[];
  freeBlocks: { startMin: number; endMin: number }[];
}

export interface BundleSummary {
  today: DayDigest;
  tomorrow: DayDigest;
  nextExam: { id: string; title: string; days: number } | null;
  lastNight: { date: string; hours: number } | null;
  week: {
    courseCount: number;
    reviewDone: number;
    reviewPlanned: number;
    sleepAvg: number | null;
  };
}

export interface FactBundle {
  generatedAt: string;
  facts: Fact[];
  byId: Record<string, Fact>;
  summary: BundleSummary;
}

export interface FactInput {
  now: Date;
  courses: Course[];
  exams: ExamItem[];
  sleeps: SleepLog[];
  blocks: { date: string; startMin: number; endMin: number; done: boolean }[];
  compliance: { date: string; done: boolean }[];
  semesterStart?: string;
  profile?: UserProfile | null;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function dayCourses(courses: Course[], date: Date, semesterStart?: string) {
  return courses
    .filter((c) => courseOccursOn(c, date, semesterStart))
    .sort((a, b) => a.startMin - b.startMin);
}

/** 从课表推导当天的空闲块（≥60 分钟的连续空档） */
function freeBlocksOf(list: Course[]): { startMin: number; endMin: number }[] {
  const start = 8 * 60;
  const end = 22 * 60;
  const busy = list
    .map((c) => [Math.max(start, c.startMin), Math.min(end, c.endMin)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const gaps: { startMin: number; endMin: number }[] = [];
  let cursor = start;
  for (const [s, e] of busy) {
    if (s - cursor >= 60) gaps.push({ startMin: cursor, endMin: s });
    cursor = Math.max(cursor, e);
  }
  if (end - cursor >= 60) gaps.push({ startMin: cursor, endMin: end });
  return gaps;
}

export function buildFacts(input: FactInput): FactBundle {
  const { now, courses, exams, sleeps, blocks, compliance, semesterStart, profile } = input;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const facts: Fact[] = [];
  const add = (f: Fact) => facts.push(f);

  const todayKey = toDateKey(today);
  const tomorrowKey = toDateKey(tomorrow);
  const tCourses = dayCourses(courses, today, semesterStart);
  const tmCourses = dayCourses(courses, tomorrow, semesterStart);

  for (const c of tCourses) {
    add({
      id: `course-today-${c.id}`,
      kind: 'course',
      label: `今天 ${hhmm(c.startMin)}–${hhmm(c.endMin)} ${c.name}（${c.location}）`,
    });
  }
  for (const c of tmCourses) {
    add({
      id: `course-tomorrow-${c.id}`,
      kind: 'course',
      label: `明天 ${hhmm(c.startMin)}–${hhmm(c.endMin)} ${c.name}（${c.location}）`,
    });
  }

  const gaps = freeBlocksOf(tCourses);
  gaps.forEach((g, i) => {
    add({
      id: `free-today-${i}`,
      kind: 'free',
      label: `今天 ${hhmm(g.startMin)}–${hhmm(g.endMin)} 空着`,
    });
  });

  // 最近一场考试 / DDL
  const upcoming = exams
    .filter((e) => new Date(e.at).getTime() >= today.getTime())
    .sort((a, b) => a.at.localeCompare(b.at));
  const next = upcoming[0];
  let nextExam: BundleSummary['nextExam'] = null;
  if (next) {
    const target = new Date(next.at);
    const days = Math.max(0, Math.round((new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() - today.getTime()) / 86_400_000));
    add({
      id: `exam-${next.id}`,
      kind: 'exam',
      label: `${next.title} · ${target.getMonth() + 1}/${target.getDate()}，还有 ${days} 天`,
      at: next.at,
    });
    nextExam = { id: next.id, title: next.title, days };
  }

  // 昨晚睡眠
  const lastNight = sleeps.find((s) => s.date === toDateKey(new Date(today.getTime() - 86_400_000)));
  if (lastNight) {
    add({
      id: `sleep-${lastNight.date}`,
      kind: 'sleep',
      label: `昨晚（${lastNight.date}）睡了 ${lastNight.hours} 小时`,
      at: lastNight.date,
    });
  }

  // 本周统计
  const monday = mondayOf(today);
  const weekKeys = new Set(
    Array.from({ length: 7 }, (_, i) => toDateKey(new Date(monday.getTime() + i * 86_400_000))),
  );
  const weekCourses = courses.filter((c) =>
    Array.from(weekKeys).some((k) => courseOccursOn(c, new Date(`${k}T00:00:00`), semesterStart)),
  ).length;
  add({ id: 'week-courses', kind: 'week', label: `本周 ${weekCourses} 节课` });

  const weekBlocks = blocks.filter((b) => weekKeys.has(b.date));
  const reviewDone = weekBlocks.filter((b) => b.done).length;
  add({
    id: 'week-review',
    kind: 'review',
    label: `本周复习 ${reviewDone}/${weekBlocks.length} 块完成`,
  });

  const weekSleeps = sleeps.filter((s) => weekKeys.has(s.date));
  const sleepAvg = weekSleeps.length
    ? Math.round((weekSleeps.reduce((sum, s) => sum + s.hours, 0) / weekSleeps.length) * 10) / 10
    : null;
  if (sleepAvg !== null) {
    add({ id: 'week-sleep', kind: 'sleep', label: `本周平均睡眠 ${sleepAvg} 小时（${weekSleeps.length} 晚）` });
  }

  const weekCompliance = compliance.filter((c) => weekKeys.has(c.date));
  if (weekCompliance.length) {
    add({
      id: 'week-compliance',
      kind: 'compliance',
      label: `本周建议执行 ${weekCompliance.filter((c) => c.done).length}/${weekCompliance.length}`,
    });
  }

  if (profile?.identity?.grade) {
    add({
      id: 'profile-identity',
      kind: 'profile',
      label: `${profile.identity.grade} · ${profile.identity.college} · ${profile.identity.campus === 'nanhu' ? '南湖' : '桂子山'}`,
    });
  }

  const byId = Object.fromEntries(facts.map((f) => [f.id, f]));

  return {
    generatedAt: now.toISOString(),
    facts,
    byId,
    summary: {
      today: { date: todayKey, courses: tCourses, freeBlocks: gaps },
      tomorrow: { date: tomorrowKey, courses: tmCourses, freeBlocks: freeBlocksOf(tmCourses) },
      nextExam,
      lastNight: lastNight ? { date: lastNight.date, hours: lastNight.hours } : null,
      week: { courseCount: weekCourses, reviewDone, reviewPlanned: weekBlocks.length, sleepAvg },
    },
  };
}
