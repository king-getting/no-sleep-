import type { RawItem } from '@/types/contract';

/**
 * 示例食堂窗口数据（桂子山校区）
 * queueBySlot：各时段排队分钟数 [早餐, 午餐低峰(<12:10), 午餐高峰, 晚餐]
 * 对应设计文档 §5.2 午饭选项卡的数据来源。
 */
export const MOCK_CANTEEN_WINDOWS: RawItem[] = [
  {
    id: 'ct-yitang-2f',
    type: 'canteen-window',
    title: '一食堂二楼 · 经济窗口',
    tags: ['食堂', '经济', '米饭'],
    campus: 'guizishan',
    payload: { avgPrice: 8, walkMin: 3, queueBySlot: [4, 5, 12, 6], peakBeforeMin: 730 /* 12:10 前低峰 */ },
  },
  {
    id: 'ct-gxy-light',
    type: 'canteen-window',
    title: '桂香园 · 轻食窗口',
    tags: ['食堂', '轻食', '健康'],
    campus: 'guizishan',
    payload: { avgPrice: 15, walkMin: 6, queueBySlot: [3, 8, 15, 10] },
  },
  {
    id: 'ct-qyc-noodle',
    type: 'canteen-window',
    title: '沁园春 · 面档',
    tags: ['食堂', '面食'],
    campus: 'guizishan',
    payload: { avgPrice: 12, walkMin: 8, queueBySlot: [5, 6, 14, 8] },
  },
  {
    id: 'ct-cvs-onigiri',
    type: 'convenience',
    title: '中百罗森（八号楼店）· 饭团便当',
    tags: ['便利店', '速食'],
    campus: 'guizishan',
    payload: { avgPrice: 10, walkMin: 2, queueBySlot: [2, 3, 5, 3] },
  },
];

/** 示例天气（生活 Agent 的天气能力数据源） */
export const MOCK_WEATHER: RawItem = {
  id: 'wx-today',
  type: 'weather',
  title: '今日天气：多云转晴 18–26°C',
  body: '午后紫外线较强，晚间转凉，建议带薄外套。',
  tags: ['天气'],
  campus: 'both',
};
