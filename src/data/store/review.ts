import { db, type ReviewBlockRecord } from '@/data/store/db';
import { coursesOfDay, computeTimeBlocks, upcomingExams } from '@/data/queries';
import { dayOfWeek } from '@/types/contract';

/**
 * 复习计划草案（B4）
 *
 * 规则来自设计文档 §4.8「生存模式」：
 * - 掌握度差的科目优先排整块，掌握度好的拆成短块
 * - 只往「整块空档」里排，不动上课时间，也不占用 12:00–13:00 的午饭
 * - 草案存在本地，用户拖拽/勾选后的结果不被自动重排覆盖
 */

export const REVIEW_MIN_SLOT = 45; // 低于 45 分钟不值得单排一块
export const REVIEW_DAY_END = 22 * 60 + 30; // 22:30 之后不排复习
export const REVIEW_DAY_MAX = 60; // 一般一天只占一小时，掌握度差的科目放宽到 90
export const LUNCH_GUARD: [number, number] = [12 * 60, 13 * 60];

const snap15 = (min: number) => Math.ceil(min / 15) * 15;
const floor15 = (min: number) => Math.floor(min / 15) * 15;

export type ReviewBlock = ReviewBlockRecord;

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateKeyOf(date: Date, offsetDays: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + offsetDays);
  return dateKey(d);
}

export async function listReviewBlocks(): Promise<ReviewBlock[]> {
  const rows = await db.reviewBlocks.toArray();
  return rows.sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date)));
}

export async function updateReviewBlock(id: string, patch: Partial<ReviewBlock>): Promise<void> {
  const cur = await db.reviewBlocks.get(id);
  if (!cur) return;
  await db.reviewBlocks.put({ ...cur, ...patch, at: new Date().toISOString() });
}

export async function deleteReviewBlock(id: string): Promise<void> {
  await db.reviewBlocks.delete(id);
}

export async function clearReviewBlocks(): Promise<void> {
  await db.reviewBlocks.clear();
}

/** 交换两块的时段（内容跟着走，时间窗互换）——拖拽的落点语义 */
export async function swapReviewBlocks(aId: string, bId: string): Promise<void> {
  if (aId === bId) return;
  const [a, b] = await Promise.all([db.reviewBlocks.get(aId), db.reviewBlocks.get(bId)]);
  if (!a || !b) return;
  const now = new Date().toISOString();
  await db.reviewBlocks.bulkPut([
    { ...a, date: b.date, startMin: b.startMin, endMin: b.endMin, at: now },
    { ...b, date: a.date, startMin: a.startMin, endMin: a.endMin, at: now },
  ]);
}

/** 把一块挪到指定日期的第一个不冲突空档；找不到就返回 false */
export async function moveReviewBlockToDate(id: string, date: string): Promise<boolean> {
  const all = await listReviewBlocks();
  const block = all.find((b) => b.id === id);
  if (!block) return false;
  const dur = block.endMin - block.startMin;
  const sameDay = all.filter((b) => b.date === date && b.id !== id).sort((a, b) => a.startMin - b.startMin);

  const d = new Date(`${date}T00:00:00`);
  const courses = await coursesOfDay(dayOfWeek(d) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
  const slots = computeTimeBlocks(courses)
    .filter((s) => s.kind !== 'class' && s.endMin - s.startMin >= dur)
    .map((s) => ({ start: Math.max(s.startMin, 8 * 60), end: Math.min(s.endMin, REVIEW_DAY_END) }))
    .filter((s) => s.end - s.start >= dur);

  for (const slot of slots) {
    let cursor = slot.start;
    while (cursor + dur <= slot.end) {
      const hitLunch = cursor < LUNCH_GUARD[1] && cursor + dur > LUNCH_GUARD[0];
      const hitBlock = sameDay.some((b) => cursor < b.endMin && cursor + dur > b.startMin);
      if (!hitLunch && !hitBlock) {
        await updateReviewBlock(id, { date, startMin: cursor, endMin: cursor + dur, done: false });
        return true;
      }
      cursor += 15;
    }
  }
  return false;
}

interface Slot {
  date: string;
  start: number;
  end: number;
}

/** 生成草案：按「掌握度低优先、离考试近优先」把整块空档排给考试 */
export async function generateReviewPlan(now: Date, horizonDays = 4): Promise<ReviewBlock[]> {
  const exams = (await upcomingExams(now, 8)).filter((e) => new Date(e.at).getTime() > now.getTime() && e.kind === 'exam');
  await db.reviewBlocks.clear();
  if (exams.length === 0) return [];

  // 候选空档：今天（留 60 分钟缓冲）到 horizonDays 天
  const slots: Slot[] = [];
  for (let d = 0; d <= horizonDays; d += 1) {
    const date = dateKeyOf(now, d);
    const day = new Date(`${date}T00:00:00`);
    const courses = await coursesOfDay(dayOfWeek(day) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
    const from = d === 0 ? Math.max(9 * 60, now.getHours() * 60 + now.getMinutes() + 60) : 9 * 60;
    for (const block of computeTimeBlocks(courses)) {
      if (block.kind === 'class') continue;
      const start = Math.max(block.startMin, from);
      const end = Math.min(block.endMin, REVIEW_DAY_END);
      if (end - start >= REVIEW_MIN_SLOT) slots.push({ date, start, end });
    }
  }
  slots.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date.localeCompare(b.date)));

  const order = [...exams].sort((a, b) => {
    const ma = a.mastery ?? 3;
    const mb = b.mastery ?? 3;
    if (ma !== mb) return ma - mb; // 掌握度低的先排
    return a.at.localeCompare(b.at);
  });

  const rows: ReviewBlock[] = [];
  const perDay = new Map<string, number>();
  let si = 0;
  let cursor = snap15(slots[0]?.start ?? 0);

  const advanceSlot = () => {
    si += 1;
    cursor = snap15(slots[si]?.start ?? 0);
  };

  for (const exam of order) {
    const mastery = exam.mastery ?? 3;
    // 掌握度越低给的总时长越多；>=4 的只排一块短复习
    const needMin = mastery <= 2 ? 180 : mastery === 3 ? 120 : 45;
    const maxChunk = mastery >= 4 ? 45 : mastery <= 2 ? 90 : 60;
    const dayBudget = mastery <= 2 ? 90 : REVIEW_DAY_MAX;
    const examDate = dateKey(new Date(exam.at));

    // 先切成若干块：每块不超过 maxChunk，不足 45 分钟的余量并进上一块，避免出现 30 分钟的碎片
    const lens: number[] = [];
    let rest = needMin;
    while (rest > 0) {
      const take = Math.min(maxChunk, rest);
      if (take >= REVIEW_MIN_SLOT || lens.length === 0) lens.push(take);
      else lens[lens.length - 1] += take;
      rest -= take;
    }

    for (const wantLen of lens) {
      while (si < slots.length) {
        const slot = slots[si];
        if (slot.date > examDate) break; // 考试都过了就别排了
        if (cursor < slot.start) cursor = snap15(slot.start);

        const dayUsed = perDay.get(slot.date) ?? 0;
        const budget = dayBudget - dayUsed;
        if (budget < REVIEW_MIN_SLOT) {
          advanceSlot();
          continue;
        }

        // 避开午饭：压在 12:00–13:00 上就从 13:00 重新开始
        if (cursor < LUNCH_GUARD[1] && cursor + REVIEW_MIN_SLOT > LUNCH_GUARD[0]) {
          cursor = snap15(LUNCH_GUARD[1]);
          continue;
        }

        const end = Math.min(slot.end, REVIEW_DAY_END);
        const room = floor15(end - cursor);
        if (room < REVIEW_MIN_SLOT) {
          advanceSlot();
          continue;
        }

        const len = Math.min(wantLen, room, budget);
        rows.push({
          id: `${exam.id}-${slot.date}-${cursor}`,
          date: slot.date,
          startMin: cursor,
          endMin: cursor + len,
          topic: exam.title,
          examId: exam.id,
          mastery,
          done: false,
          at: new Date().toISOString(),
        });
        perDay.set(slot.date, dayUsed + len);
        cursor += len;
        if (cursor >= end) advanceSlot();
        break;
      }
      if (si >= slots.length) break;
    }
  }

  if (rows.length > 0) await db.reviewBlocks.bulkPut(rows);
  return rows;
}
