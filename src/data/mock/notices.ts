import type { RawItem } from '@/types/contract';

/**
 * 只属于「这台设备」的示例条目
 *
 * 通知类内容已经换成华中师范大学的真实通知快照（见 `src/data/mock/ccnu.ts`）——
 * 那些是公开页面上的原文，带链接和日期。
 * 这里只留「快递到站」这类本来就因人而异、没有公开来源的个人条目。
 */
export const MOCK_NOTICES: RawItem[] = [
  {
    id: 'n-express-1',
    type: 'express',
    title: '快递到站：菜鸟驿站（东区）有 1 个包裹待取',
    body: '取件码已通过短信发送，驿站 21:00 关门。（示例数据）',
    tags: ['快递', '生活'],
    campus: 'guizishan',
  },
];
