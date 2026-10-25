/**
 * 数值展示统一口径。
 * 之前「¥8」「8 元」「9.5h」「42h」「约 25 分钟」混着出现，同一屏里像来自三个产品。
 */

export function fmtMoney(yuan: number): string {
  return `¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(1)}`;
}

/** 分钟 → 「25 分钟」「1.5 小时」「1 小时」 */
export function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '不占时间';
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
}

/** 小时数 → 「7.2 小时」「9.5h」统一成前者，避免 h 与「小时」混用 */
export function fmtHours(hours: number): string {
  return `${hours.toFixed(1)} 小时`;
}

/** 3 档忙碌程度，比「费不费神」四个字更适合放在 chip 里 */
export function fmtEffort(effort: 1 | 2 | 3): string {
  return effort === 1 ? '省心' : effort === 2 ? '要跑一趟' : '挺折腾';
}
