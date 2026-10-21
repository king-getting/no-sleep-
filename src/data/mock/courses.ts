import type { Course, ExamItem } from '@/types/contract';

/**
 * 示例课表（mock JSON 导入的占位实现）
 * 覆盖一整周，任何日期演示都有课上；周三故意排成「早八连排 + 午休被吃掉」用于风险预警演示。
 * 真实教务导入落地后替换为 IndexedDB 读取，接口不变。
 */
export const MOCK_COURSES: Course[] = [
  // 周一
  { id: 'c-mon-1', name: '高等数学 A（下）', teacher: '王老师', location: '八号楼 8201', dayOfWeek: 1, startMin: 480, endMin: 575 }, // 8:00–9:35
  { id: 'c-mon-2', name: '大学英语（四）', teacher: '李老师', location: '三号楼 3305', dayOfWeek: 1, startMin: 595, endMin: 690 }, // 9:55–11:30
  { id: 'c-mon-3', name: '数据结构', teacher: '陈老师', location: '九号楼 9402', dayOfWeek: 1, startMin: 840, endMin: 935 }, // 14:00–15:35
  // 周二
  { id: 'c-tue-1', name: '线性代数', teacher: '周老师', location: '八号楼 8303', dayOfWeek: 2, startMin: 595, endMin: 690 },
  { id: 'c-tue-2', name: '体育（篮球）', teacher: '赵老师', location: '佑铭体育馆', dayOfWeek: 2, startMin: 840, endMin: 930 },
  // 周三：早八连排 + 午休被吃掉（风险预警演示日）
  { id: 'c-wed-1', name: '数据结构', teacher: '陈老师', location: '九号楼 9402', dayOfWeek: 3, startMin: 480, endMin: 575 }, // 8:00–9:35
  { id: 'c-wed-2', name: '操作系统', teacher: '吴老师', location: '九号楼 9301', dayOfWeek: 3, startMin: 585, endMin: 680 }, // 9:45–11:20 连排
  { id: 'c-wed-3', name: '马克思主义基本原理', teacher: '刘老师', location: '一号楼 1201', dayOfWeek: 3, startMin: 690, endMin: 760 }, // 11:30–12:40 吃掉午休
  { id: 'c-wed-4', name: '概率论与数理统计', teacher: '郑老师', location: '八号楼 8401', dayOfWeek: 3, startMin: 840, endMin: 935 },
  // 周四
  { id: 'c-thu-1', name: '高等数学 A（下）', teacher: '王老师', location: '八号楼 8201', dayOfWeek: 4, startMin: 480, endMin: 575 },
  { id: 'c-thu-2', name: '大学英语（四）', teacher: '李老师', location: '三号楼 3305', dayOfWeek: 4, startMin: 840, endMin: 935 },
  // 周五
  { id: 'c-fri-1', name: '操作系统', teacher: '吴老师', location: '九号楼 9301', dayOfWeek: 5, startMin: 595, endMin: 690 },
  { id: 'c-fri-2', name: '书法鉴赏（通选）', teacher: '孙老师', location: '美术学院 210', dayOfWeek: 5, startMin: 990, endMin: 1080 },
];

/**
 * 示例考试 / DDL —— 相对当前时间动态生成，保证演示永远「DDL 在 48h 后」，
 * 从而稳定触发日程 Agent 的复习主张与健康 Agent 的睡眠主张冲突（设计文档 §5.3 示例）。
 */
export function buildMockExams(now: Date): ExamItem[] {
  const at = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();
  return [
    { id: 'exam-ds', title: '数据结构期中考试', kind: 'exam', at: at(6 * 24), mastery: 3 },
    { id: 'ddl-os', title: '操作系统实验报告 DDL', kind: 'ddl', at: at(40), mastery: 2 },
    { id: 'ddl-eng', title: '英语视听说作业 DDL', kind: 'ddl', at: at(3 * 24), mastery: 4 },
  ];
}
