import type { Report } from '@/types/contract';

/**
 * B（体验）专用：固定输出一份午间报告 JSON（严格对应设计文档 §5.2 示例）。
 * UI 开发一律用它驱动，不依赖 A 的引擎进度；A 的真实编排器就绪后，
 * UI 只需把数据源从本文件换成 orchestrator.run()，渲染代码零改动。
 */
export function getMockNoonReport(): Report {
  return {
    type: 'noon',
    generatedAt: new Date(),
    blocks: [
      {
        kind: 'overview',
        items: [
          { label: '上午回顾', value: '已上 3/4 节课' },
          { label: '下午安排', value: '14:00 概率论（八号楼 8401）' },
          { label: '时间块', value: '整块空档 1 段（15:35–23:00）；碎片 1 段' },
          { label: '风险项', value: '2 项需留意', tone: 'warn' },
        ],
      },
      {
        kind: 'suggestionGroup',
        suggestion: {
          id: 'sug-lunch',
          topic: '午饭吃什么',
          priority: 1,
          slot: 'noon',
          sourceFindingIds: ['life:weather'],
          options: [
            {
              id: 'lunch-a',
              title: '一食堂二楼经济窗口',
              cost: { money: 8, timeMin: 8 },
              pros: ['省钱', '排队约 5 分钟、步行 3 分钟'],
              cons: ['口味普通，选择少'],
              impacts: [{ horizon: 'short', text: '预算宽裕，晚餐可选更想吃的', agentId: 'life' }],
              evidences: [
                { agentId: 'life', text: '该窗口 12:10 前为低峰', confidence: 2 },
                { agentId: 'life', text: '符合你本月日均餐标 ¥25 的预算（占 32%）', confidence: 3 },
              ],
            },
            {
              id: 'lunch-b',
              title: '桂香园轻食',
              cost: { money: 15, timeMin: 21 },
              pros: ['清淡，午后不犯困'],
              cons: ['贵', '排队约 15 分钟'],
              impacts: [{ horizon: 'long', text: '常选轻食会让本周餐标吃紧', agentId: 'life' }],
              evidences: [{ agentId: 'health', text: '你昨晚睡眠 5.5h，清淡饮食午后不犯困', confidence: 2 }],
            },
            {
              id: 'lunch-c',
              title: '便利店饭团 + 提前去教室',
              cost: { money: 10, timeMin: 5 },
              pros: ['省下约 25 分钟'],
              cons: ['吃得将就'],
              impacts: [{ horizon: 'short', text: '下午预习到位，第一节课听课更轻松', agentId: 'schedule' }],
              evidences: [{ agentId: 'schedule', text: '下午第一节前有一段碎片时间，可用来预习', confidence: 2 }],
            },
          ],
        },
      },
      {
        kind: 'conflict',
        conflict: {
          id: 'conflict-tonight-slot',
          topic: 'tonight-slot',
          level: 'L2',
          planA: {
            id: 'plan-study-first',
            agentId: 'schedule',
            title: '学习优先：今晚复习至 23:30',
            cost: { timeMin: 150 },
            pros: ['复习时间充足，DDL 稳妥'],
            cons: ['睡眠连续第 4 天 <6h'],
            impacts: [
              { horizon: 'short', text: '明早前两节课注意力下降风险高', agentId: 'schedule' },
              { horizon: 'long', text: '缺觉累积，或影响后天考试状态', agentId: 'health' },
            ],
            evidences: [{ agentId: 'schedule', text: '操作系统实验报告 DDL 在 48h 后', confidence: 2 }],
          },
          planB: {
            id: 'plan-health-first',
            agentId: 'health',
            title: '健康优先：23:00 睡，明早 7:00 起补 1h',
            cost: { timeMin: 60 },
            pros: ['睡眠恢复，明早状态好'],
            cons: ['复习时间 −1h'],
            impacts: [{ horizon: 'short', text: '需挪用明晚 1h 整块时间补复习，压缩休息', agentId: 'schedule' }],
            evidences: [{ agentId: 'health', text: '近三天平均睡 5.8h，连续不足', confidence: 3 }],
          },
        },
      },
      {
        kind: 'warning',
        text: '昨晚睡眠不足 6h，且今天有连排，下午犯困风险高',
        agentId: 'health',
      },
    ],
  };
}
