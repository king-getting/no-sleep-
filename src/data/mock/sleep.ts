import type { SleepLog } from '@/types/contract';

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 示例睡眠数据（带「示例数据」标签，可一键清除）
 * 故意造出「近三天平均 5.8h、昨晚 5.5h」的形态，
 * 稳定触发：午间小憩建议、熬夜提醒、考前夜级别的睡眠不足红线（设计文档 §4.5/§5.3）。
 */
export function buildDemoSleepLogs(now = new Date()): SleepLog[] {
  const hoursSeq = [6.5, 7, 5.5, 6.5, 5.5, 6.5, 5.5]; // 7 天前 → 昨晚
  return hoursSeq.map((hours, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (7 - i));
    return {
      date: dateStr(d),
      hours,
      bedTimeMin: hours < 6 ? 1440 + 40 : 1410, // 缺觉的日子 0:40 才睡，正常 23:30
    };
  });
}
