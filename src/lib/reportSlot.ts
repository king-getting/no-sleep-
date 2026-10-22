import type { Trigger } from '@/orchestrator';

/** 演示模式：把「今天的某个时刻」转成 Date，用于手动唤出任意时段的报告（§4.9 路演刚需） */
export function atTime(hour: number, minute: number, base = new Date()): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export interface ReportSlot {
  trigger: Trigger;
  /** 该报告的名义时刻：晨间 7:30 / 午间 11:30 / 晚间 21:30 */
  at: Date;
}

/**
 * 当前所处时段（A5 本地定时触发器的判定部分）
 *
 * 05:00–10:29 晨间 · 10:30–15:59 午间 · 16:00–04:59 晚间
 *
 * 跨天不需要额外的补生成逻辑：调用方每分钟轮询一次，时段键变化即重新生成，
 * 午夜从晚间切到晨间会自然触发一次「补生成」。
 */
export function currentSlot(now = new Date()): ReportSlot {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 5 && h < 10.5) return { trigger: 'morning-report', at: atTime(7, 30, now) };
  if (h >= 10.5 && h < 16) return { trigger: 'noon-report', at: atTime(11, 30, now) };
  return { trigger: 'evening-report', at: atTime(21, 30, now) };
}

/** 时段标识（含日期）：用于轮询时判断「是否跨段 / 跨天」 */
export function slotKey(slot: ReportSlot): string {
  return `${slot.trigger}:${slot.at.toDateString()}`;
}
