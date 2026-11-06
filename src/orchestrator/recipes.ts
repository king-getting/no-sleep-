import type { BlockKind, ReportType } from '@/types/contract';

/**
 * 报告配方（契约 §4）：每种报告 = 一份区块清单。
 * MVP 砍功能 = 改这里的配方，不改渲染代码。
 */
export const RECIPES: Record<ReportType, BlockKind[]> = {
  morning: ['overview', 'analysis', 'suggestionGroup', 'warning'],
  noon: ['overview', 'analysis', 'suggestionGroup', 'conflict', 'warning'],
  evening: ['recap', 'analysis', 'suggestionGroup', 'preview', 'conflict'],
  // 生存模式注入（设计文档 §4.8 MVP 裁剪版）
  'exam-day': ['overview', 'warning', 'suggestionGroup', 'checklist'],
  'exam-week': ['overview', 'warning', 'suggestionGroup', 'conflict', 'recap'],
  // 考后小结（B10）：考完 2–6 小时内，从「冲刺」切到「复盘」
  'exam-done': ['overview', 'warning', 'recap', 'suggestionGroup'],
};
