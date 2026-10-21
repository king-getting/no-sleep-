import type { RawItem } from '@/types/contract';

/**
 * 示例通知流（三类源：①教务/学院通知 ②讲座与活动 ③生活服务）
 * 带 campus / audience 标签，信息流按身份过滤 + 相关性打分。
 */
export const MOCK_NOTICES: RawItem[] = [
  {
    id: 'n-jw-1',
    type: 'notice',
    title: '【教务处】2026 秋季学期期中考试安排已发布',
    body: '请各位同学登录教务系统查看本人考场安排，注意考试周从第 11 周开始。',
    tags: ['教务', '考试'],
    campus: 'both',
    audience: ['undergrad'],
  },
  {
    id: 'n-jw-2',
    type: 'notice',
    title: '【计算机学院】数据结构期中复习答疑（周三晚 7 点）',
    body: '地点：九号楼 9402，答疑教师：陈老师。',
    tags: ['学院', '答疑', '数据结构'],
    campus: 'guizishan',
    audience: ['undergrad', '大二', '计算机学院'],
  },
  {
    id: 'n-act-1',
    type: 'notice',
    title: '讲座：从桂子山到硅谷——校友分享会',
    body: '周四 19:00 科学会堂，素拓学分 0.5。',
    tags: ['讲座', '素拓'],
    campus: 'guizishan',
  },
  {
    id: 'n-life-1',
    type: 'notice',
    title: '校车时刻调整：桂子山 ⇌ 南湖末班车提前至 21:30',
    body: '本周起执行，请跨校区同学注意。',
    tags: ['校车'],
    campus: 'both',
  },
  {
    id: 'n-life-2',
    type: 'notice',
    title: '停水通知：东区宿舍周五 23:00–次日 5:00 停水检修',
    tags: ['宿舍', '停水'],
    campus: 'guizishan',
  },
  {
    id: 'n-express-1',
    type: 'express',
    title: '快递到站：菜鸟驿站（东区）有 1 个包裹待取',
    body: '取件码已通过短信发送，驿站 21:00 关门。',
    tags: ['快递', '生活'],
    campus: 'guizishan',
  },
];
