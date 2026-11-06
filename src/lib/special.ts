/**
 * 节日与纪念日
 *
 * 先做固定公历节日（不引入农历库，避免为了中秋春节塞一个几百 KB 的表）；
 * 用户自己的纪念日存在本机 localStorage，格式 [{month,day,label}]，不上传。
 */

export interface SpecialDay {
  label: string;
  /** 报告/对话里用的一句问候，别写成客服腔 */
  greeting: string;
}

const FESTIVALS: Record<string, SpecialDay> = {
  '01-01': { label: '元旦', greeting: '新年第一天，先别急着排满，留一点给自己。' },
  '03-08': { label: '妇女节', greeting: '今天是妇女节，记得给妈妈发条消息。' },
  '05-01': { label: '劳动节', greeting: '放假第一天，先把休息安排好，再谈计划。' },
  '05-04': { label: '青年节', greeting: '青年节快乐，今天适合干一件一直想干没干的小事。' },
  '06-01': { label: '儿童节', greeting: '儿童节，允许自己幼稚一会儿。' },
  '09-10': { label: '教师节', greeting: '今天是教师节，给还记得你的老师发句问候吧。' },
  '10-01': { label: '国庆节', greeting: '国庆假期开始了，先想清楚这几天是休息还是赶进度。' },
  '12-31': { label: '跨年夜', greeting: '今年最后一天，适合回头看看，也适合早点睡。' },
};

const KEY = 'xiaoshan:anniversaries';

export interface Anniversary {
  month: number;
  day: number;
  label: string;
}

export function loadAnniversaries(): Anniversary[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Anniversary[];
    return Array.isArray(list)
      ? list.filter((a) => a && a.month >= 1 && a.month <= 12 && a.day >= 1 && a.day <= 31 && a.label)
      : [];
  } catch {
    return [];
  }
}

export function saveAnniversaries(list: Anniversary[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event('xiaoshan:anniversaries-changed'));
}

/** 今天是什么日子；没有就返回 null */
export function specialDayOf(date: Date): SpecialDay | null {
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const fixed = FESTIVALS[md];
  if (fixed) return fixed;

  const mine = loadAnniversaries().find((a) => a.month === date.getMonth() + 1 && a.day === date.getDate());
  if (mine) return { label: mine.label, greeting: `今天是${mine.label}，记着这件事比记着课表重要。` };

  return null;
}
