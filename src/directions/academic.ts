import { todayCourses, upcomingExams } from '@/data/queries';
import { fmtMin } from '@/types/contract';
import type { DirectionModule, DirectionResult, Finding } from '@/types/contract';

/** 午间可用窗口低于这个值，就认为「坐下来慢慢吃」不可行 */
const TIGHT_WINDOW_MIN = 75;

/**
 * 学习 方向：课表 / 考试
 * 只访问学习域数据，输出结构化 Finding（结论 / 依据 / 置信度）。
 *
 * 除了报事实，还会在课压住午间窗口时**产出一条硬约束主张**，
 * 交给仲裁器去叫停生活/健康那种「慢慢吃、走远点吃」的柔性方案。
 * 这是「多方向互相约束」里唯一不可协商的一方：课不会等你。
 */
export const academicDirection: DirectionModule = {
  id: 'academic',
  name: '学习',
  version: '0.2.0',
  capabilities: ['course.query', 'exam.query'],
  defaultWeight: 2,
  enabled: true,

  async run(ctx) {
    const findings: Finding[] = [];
    const courses = await todayCourses(ctx.now);

    findings.push({
      id: 'academic:today-courses',
      type: 'fact',
      topic: '课表',
      confidence: 3,
      summary:
        courses.length > 0
          ? `今天 ${courses.length} 节课：${courses.map((c) => `${fmtMin(c.startMin)} ${c.name}`).join('，')}`
          : '今天没有课',
      evidences: [{ directionId: 'academic', text: '数据来源：已导入的课表（示例）', confidence: 3 }],
    });

    const exams = await upcomingExams(ctx.now);
    for (const e of exams) {
      const hoursLeft = Math.round((new Date(e.at).getTime() - ctx.now.getTime()) / 3600_000);
      const isExam = e.kind === 'exam';
      findings.push({
        id: `academic:${e.id}`,
        type: hoursLeft <= 7 * 24 ? 'warning' : 'fact',
        topic: isExam ? '考试' : 'DDL',
        confidence: 3,
        summary: `「${e.title}」${hoursLeft < 24 ? '就在明天前' : `还剩 ${Math.round(hoursLeft / 24)} 天`}（掌握度自评 ${e.mastery ?? '-'}/5）`,
        evidences: [{ directionId: 'academic', text: `截止：${new Date(e.at).toLocaleString('zh-CN')}`, confidence: 3 }],
      });
    }

    if (ctx.mode === 'exam') {
      findings.push({
        id: 'academic:exam-mode',
        type: 'fact',
        topic: '模式',
        confidence: 3,
        summary: '生存模式已激活：学习权重提升，考试相关通知置顶',
      });
    }

    const result: DirectionResult = { directionId: 'academic', findings };

    // ── 硬约束：课把午间窗口压短时，叫停「坐下来慢慢吃」的方案 ──
    const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    const inLunchWindow = nowMin >= 10 * 60 && nowMin < 14 * 60;
    const nextClass = courses.find((c) => c.startMin > nowMin);
    if (inLunchWindow && nextClass) {
      const windowMin = nextClass.startMin - nowMin;
      if (windowMin <= TIGHT_WINDOW_MIN) {
        findings.push({
          id: 'academic:lunch-window',
          type: 'conflict',
          topic: '午间窗口',
          confidence: 3,
          summary: `${fmtMin(nextClass.startMin)} 有「${nextClass.name}」，从现在起午间只剩 ${windowMin} 分钟——吃饭的时间被课挤掉了`,
          evidences: [
            {
              directionId: 'academic',
              text: `课程时间：${fmtMin(nextClass.startMin)}–${fmtMin(nextClass.endMin)}（${nextClass.location}）`,
              confidence: 3,
            },
          ],
        });

        result.conflictClaims = [
          {
            topic: '今天的午饭',
            side: 'hard-class',
            plan: {
              id: 'lunch-class-window',
              directionId: 'academic',
              title: `上课优先：${fmtMin(nextClass.startMin)} 有「${nextClass.name}」，午间只剩 ${windowMin} 分钟`,
              note: `${nextClass.location} · 走过去还要时间`,
              when: `今天 ${fmtMin(nowMin)}–${fmtMin(nextClass.startMin)}`,
              cost: { timeMin: windowMin, effort: 1 },
              pros: [
                `${fmtMin(nextClass.startMin)} 的课不能迟到，这个不商量`,
                `扣掉路上时间，能坐下来吃的只有 ${Math.max(10, windowMin - 20)} 分钟左右`,
              ],
              cons: ['只能在最近的窗口快速解决，排长队或者走远一点都会赶不上'],
              fallback: '按原计划慢慢吃，大概率踩着上课铃进教室',
              impacts: [
                {
                  horizon: 'short',
                  text: '迟到一次可能被记，而且前半节课基本在喘气',
                  directionId: 'academic',
                },
              ],
              evidences: [
                {
                  directionId: 'academic',
                  text: `课表：${fmtMin(nextClass.startMin)} ${nextClass.name}（${nextClass.location}）`,
                  confidence: 3,
                },
              ],
            },
          },
        ];
      }
    }

    return result;
  },
};
