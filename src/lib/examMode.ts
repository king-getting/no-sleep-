import type { ExamItem, Mode, ReportType } from '@/types/contract';

/**
 * 生存模式判定层（设计文档 §4.8 / dev-tasks A6）
 *
 * 纯函数：只吃「考试列表 + 当前时刻」，不读库、不产生副作用，便于单测与在 orchestrator 里复用。
 * 判定规则（MVP 版）：
 *   - 最近一场未结束的考试在 7 个自然日以内 → 进入 exam 模式
 *   - 考试当天（自然日差 = 0）→ 考试日（exam-day 报告）
 *   - 窗口内还有考试但非当天 → 冲刺周（exam-week 报告）
 *   - 所有考试都结束后 → 自动退出生存模式（mode 回到 normal）
 */

/** 考前多少天进入生存模式 */
export const EXAM_LEAD_DAYS = 7;

/** 考试日宽限：考完 6 小时内仍按「考试日」处理（上午考试，下午还该出考试日报告） */
const EXAM_DAY_GRACE_MS = 6 * 3600_000;

export interface ExamWindow {
  mode: Mode;
  /** 距最近一场考试的自然日天数：今天 = 0，明天 = 1；窗口外或无考试为 null */
  daysToExam: number | null;
  /** 今天是否就是考试日 */
  isExamDay: boolean;
  /** 窗口内最近的一场考试 */
  nextExam: ExamItem | null;
  /** 窗口内全部考试 / DDL，按时间升序 */
  upcoming: ExamItem[];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 自然日差：今天 → 今天 = 0，今天 → 明天 = 1（按日历日，不按 24h） */
function dayDiff(fromMs: number, toMs: number): number {
  return Math.round((startOfDay(toMs) - startOfDay(fromMs)) / 86_400_000);
}

/**
 * 计算生存模式窗口。
 * 退出条件实现方式：只保留「尚未结束」的考试，列表为空即自动回到 normal。
 */
export function examWindowOf(exams: ExamItem[], now: Date): ExamWindow {
  const nowMs = now.getTime();
  const upcoming = exams
    .filter((e) => new Date(e.at).getTime() + EXAM_DAY_GRACE_MS >= nowMs)
    .sort((a, b) => a.at.localeCompare(b.at));

  const next = upcoming[0];
  if (!next) {
    return { mode: 'normal', daysToExam: null, isExamDay: false, nextExam: null, upcoming: [] };
  }

  const days = dayDiff(nowMs, new Date(next.at).getTime());
  const inWindow = days >= 0 && days <= EXAM_LEAD_DAYS;

  return {
    mode: inWindow ? 'exam' : 'normal',
    daysToExam: days,
    isExamDay: inWindow && days === 0,
    nextExam: next,
    upcoming,
  };
}

/** 生存模式下该用哪种报告配方（recipes.ts 已备好 exam-day / exam-week） */
export function examReportTypeOf(w: ExamWindow): ReportType {
  return w.isExamDay ? 'exam-day' : 'exam-week';
}

/**
 * 考后小结的起点：开考 2 小时后算「刚考完」。
 * ExamItem 只有开始时间没有结束时间，按常见考试时长估一个下限，
 * 宁可晚一点出小结，也不要在人还在考场时宣告考完。
 */
export const EXAM_DONE_AFTER_MS = 120 * 60_000;

/** 考后小结的展示窗口：考完 6 小时内还会出（之后回到普通日报） */
export const EXAM_DONE_WINDOW_MS = 6 * 3600_000;

/** 刚刚考完的那一场（在考后小结窗口内），没有则 null */
export function justFinishedExam(exams: ExamItem[], now: Date): ExamItem | null {
  const t = now.getTime();
  const finished = exams.filter((e) => {
    const start = new Date(e.at).getTime();
    if (Number.isNaN(start)) return false;
    return t >= start + EXAM_DONE_AFTER_MS && t <= start + EXAM_DONE_WINDOW_MS;
  });
  return finished.length > 0 ? finished[finished.length - 1] : null;
}

/** 倒计时文案：'今天 14:00' / '3 天后 09:00' / '已结束' */
export function countdownText(item: ExamItem, now: Date): string {
  const at = new Date(item.at);
  if (Number.isNaN(at.getTime())) return '时间待定';
  const days = dayDiff(now.getTime(), at.getTime());
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (days < 0) return '已结束';
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `明天 ${hm}`;
  return `${days} 天后 ${hm}`;
}

/** 掌握度 → 复习策略一句话（生存模式报告的「为什么这样排」） */
export function masteryAdvice(mastery: ExamItem['mastery']): string {
  switch (mastery) {
    case 1:
      return '掌握度 1/5：先补框架，别刷题';
    case 2:
      return '掌握度 2/5：整块时间过一遍重点章节';
    case 3:
      return '掌握度 3/5：整块做套题 + 错题回看';
    case 4:
      return '掌握度 4/5：只做真题手感，别重复看书';
    case 5:
      return '掌握度 5/5：保持手感即可，把时间让给最弱的一门';
    default:
      return '未自评掌握度：按「先整块过一遍」处理';
  }
}
