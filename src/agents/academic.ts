import { todayCourses, upcomingExams } from '@/data/queries';
import { fmtMin } from '@/types/contract';
import type { AgentModule, AgentResult, Finding } from '@/types/contract';

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
    const suggestions: NonNullable<AgentResult['suggestions']> = [];
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
      evidences: [{ agentId: 'academic', text: '数据来源：已导入的课表（示例）', confidence: 3 }],
    });

    const exams = await upcomingExams(ctx.now);
    for (const e of exams) {
      const hoursLeft = Math.round((new Date(e.at).getTime() - ctx.now.getTime()) / 3600_000);
      const isExam = e.kind === 'exam';
      // 已经开考的（含刚考完还在 6 小时宽限期里的）不能再报「就在明天前」
      if (hoursLeft <= 0) {
        if (hoursLeft > -6) {
          findings.push({
            id: `academic:${e.id}`,
            type: 'fact',
            topic: isExam ? '考试' : 'DDL',
            confidence: 3,
            summary: `「${e.title}」${hoursLeft > -1 ? '正在进行' : `已开考 ${-hoursLeft} 小时`}`,
            evidences: [{ agentId: 'academic', text: `开始：${new Date(e.at).toLocaleString('zh-CN')}`, confidence: 3 }],
          });
        }
        continue;
      }
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

    // ── 复习重心（P4）────────────────────────────────────────────
    // 教务域一直只产 finding、没有可点卡片，报告里「学业取舍」这个声音是缺席的。
    // 只在真的有取舍时出卡片：最近一个 DDL 快到了，而考试还在它后面。
    // 不硬造二选一——没事可权衡就闭嘴，比多一张卡更值钱。
    const byDate = [...exams].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    const nextDdl = byDate.find((e) => e.kind === 'ddl');
    const nextExam = byDate.find((e) => e.kind === 'exam');
    const dayGap = (at: string) =>
      Math.max(1, Math.round((new Date(at).getTime() - ctx.now.getTime()) / 86400_000));

    if (nextDdl && nextExam) {
      const daysToDdl = dayGap(nextDdl.at);
      const daysToExam = dayGap(nextExam.at);
      if (daysToDdl <= 3 && daysToExam > daysToDdl) {
        const focusFindingId = 'academic:priority';
        findings.push({
          id: focusFindingId,
          type: 'suggestion',
          topic: '复习重心',
          confidence: 3,
          summary: `「${nextDdl.title}」${daysToDdl} 天内截止，「${nextExam.title}」还有 ${daysToExam} 天：先清哪一个`,
        });
        suggestions.push({
          id: 'sug-academic-priority',
          topic: '复习重心',
          priority: 2,
          slot: ctx.now.getHours() < 11 ? 'morning' : ctx.now.getHours() < 17 ? 'noon' : 'evening',
          sourceFindingIds: [focusFindingId],
          options: [
            {
              id: 'academic-priority-ddl',
              title: `先清《${nextDdl.title}》（${daysToDdl} 天内）`,
              note: '硬性提交物 · 逾期直接扣分',
              when: `${daysToDdl} 天内`,
              cost: { timeMin: 40, effort: 2 },
              pros: ['截止最近，交掉就不用边复习边惦记', '报告类是一次性交付，不存在考砸的风险'],
              cons: ['接下来几天的复习排期整体后移'],
              fallback: 'DDL 拖到最后一天，通常会变成熬夜补',
              impacts: [
                { horizon: 'short', text: '本周复习排期整体后移一天', agentId: 'academic' },
                { horizon: 'long', text: '逾期扣的平时分，事后补不回来', agentId: 'academic' },
              ],
              evidences: [
                {
                  agentId: 'academic',
                  text: `截止：${new Date(nextDdl.at).toLocaleString('zh-CN')} · 掌握度自评 ${nextDdl.mastery ?? '-'}/5`,
                  confidence: 3,
                },
              ],
            },
            {
              id: 'academic-priority-exam',
              title: `先补《${nextExam.title}》（自评 ${nextExam.mastery ?? '-'}/5）`,
              note: '只考一次 · 没有补交机会',
              when: `${daysToExam} 天内`,
              cost: { timeMin: 60, effort: 3 },
              pros: [
                '考试只考一次，复习窗口不可压缩',
                `自评掌握度 ${nextExam.mastery ?? '-'}/5，越早开工越省力`,
              ],
              cons: [`DDL 要在 ${daysToDdl} 天内赶完，容易挤到深夜`],
              fallback: '考试前才动，最后只能挑重点硬背',
              impacts: [
                { horizon: 'short', text: `DDL 的可用时间被压到 ${daysToDdl} 天内`, agentId: 'academic' },
                { horizon: 'long', text: '弱项拖到最后，考试当天没有回头补的余地', agentId: 'academic' },
              ],
              evidences: [
                {
                  agentId: 'academic',
                  text: `考试：${new Date(nextExam.at).toLocaleString('zh-CN')} · 掌握度自评 ${nextExam.mastery ?? '-'}/5`,
                  confidence: 3,
                },
              ],
            },
          ],
        });
      }
    }

    return { agentId: 'academic', findings, suggestions };
  },
};
