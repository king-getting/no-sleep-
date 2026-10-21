import { todayCourses, upcomingExams } from '@/data/queries';
import { fmtMin } from '@/types/contract';
import type { AgentModule, Finding } from '@/types/contract';

/**
 * 教务 Agent：课表 / 考试
 * 只访问教务域数据，输出结构化 Finding（结论 / 依据 / 置信度）。
 */
export const academicAgent: AgentModule = {
  id: 'academic',
  name: '教务',
  version: '0.1.0',
  capabilities: ['course.query', 'exam.query'],
  defaultWeight: 2,
  enabled: true,

  async run(ctx) {
    const findings: Finding[] = [];
    const courses = todayCourses(ctx.now);

    findings.push({
      id: 'academic:today-courses',
      type: 'fact',
      topic: '课表',
      confidence: 3,
      summary:
        courses.length > 0
          ? `今天 ${courses.length} 节课：${courses.map((c) => `${fmtMin(c.startMin)} ${c.name}`).join('，')}`
          : '今天没有课',
      evidences: [{ agentId: 'academic', text: '数据来源：已导入的课表（示例）', confidence: 3 }],
    });

    const exams = upcomingExams(ctx.now);
    for (const e of exams) {
      const hoursLeft = Math.round((new Date(e.at).getTime() - ctx.now.getTime()) / 3600_000);
      const isExam = e.kind === 'exam';
      findings.push({
        id: `academic:${e.id}`,
        type: hoursLeft <= 7 * 24 ? 'warning' : 'fact',
        topic: isExam ? '考试' : 'DDL',
        confidence: 3,
        summary: `「${e.title}」${hoursLeft < 24 ? '就在明天前' : `还剩 ${Math.round(hoursLeft / 24)} 天`}（掌握度自评 ${e.mastery ?? '-'}/5）`,
        evidences: [{ agentId: 'academic', text: `截止：${new Date(e.at).toLocaleString('zh-CN')}`, confidence: 3 }],
      });
    }

    if (ctx.mode === 'exam') {
      findings.push({
        id: 'academic:exam-mode',
        type: 'fact',
        topic: '模式',
        confidence: 3,
        summary: '生存模式已激活：教务权重提升，考试相关通知置顶',
      });
    }

    return { agentId: 'academic', findings };
  },
};
