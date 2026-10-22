import { coursesOfDay, todayCourses } from '@/data/queries';
import { db } from '@/data/store/db';
import { getSleepLogs } from '@/data/store/profile';
import { avgSleepHours, lastNightSleep } from '@/data/queries';
import { dayOfWeek, fmtMin } from '@/types/contract';
import { RECIPES } from './recipes';
import { examEveChecklist } from './exam';
import type {
  AgentContext,
  AgentResult,
  ConflictCard,
  OverviewItem,
  Report,
  ReportBlock,
  ReportType,
  Suggestion,
} from '@/types/contract';

/**
 * 报告组装：按配方把各 Agent 的结构化产出拼成 Report。
 * 报告 = 区块拼装，UI 只按 Schema 渲染。
 */

const SLOT_OF: Record<ReportType, Suggestion['slot'] | null> = {
  morning: 'morning',
  noon: 'noon',
  evening: 'evening',
  'exam-day': null, // 生存模式报告聚合全部时段的建议
  'exam-week': null,
};

async function buildOverview(type: ReportType, results: AgentResult[], ctx: AgentContext): Promise<OverviewItem[]> {
  const findings = results.flatMap((r) => r.findings);
  const fact = (id: string) => findings.find((f) => f.id === id)?.summary ?? '—';
  const warnings = findings.filter((f) => f.type === 'warning');

  if (type === 'noon') {
    const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    const courses = await todayCourses(ctx.now);
    const done = courses.filter((c) => c.endMin <= nowMin).length;
    const rest = courses.length - done;
    return [
      { label: '上午回顾', value: `已上 ${done}/${courses.length} 节课` },
      { label: '下午安排', value: rest > 0 ? `还有 ${rest} 节课` : '下午没课' },
      { label: '时间块', value: fact('schedule:timeblocks') },
      { label: '风险项', value: warnings.length > 0 ? `${warnings.length} 项需留意` : '无', tone: warnings.length > 0 ? 'warn' : 'default' },
    ];
  }

  // 生存模式（A6）：overview 换成「倒计时 + 复习窗口」，风险项在考前 3 天内变红
  if (type === 'exam-day' || type === 'exam-week') {
    const urgent = warnings.some((w) => w.id === 'exam:lead');
    return [
      { label: '倒计时', value: fact('exam:countdown') },
      { label: '今日课程', value: fact('academic:today-courses') },
      { label: '复习窗口', value: fact('exam:blocks') },
      {
        label: '风险项',
        value: warnings.length > 0 ? `${warnings.length} 项需留意` : '无',
        tone: urgent ? 'danger' : warnings.length > 0 ? 'warn' : 'default',
      },
    ];
  }

  return [
    { label: '今日课程', value: fact('academic:today-courses') },
    { label: '时间块', value: fact('schedule:timeblocks') },
    { label: '天气', value: fact('life:weather') },
    { label: '风险项', value: warnings.length > 0 ? `${warnings.length} 项需留意` : '无', tone: warnings.length > 0 ? 'warn' : 'default' },
  ];
}

async function buildRecap(ctx: AgentContext): Promise<{ label: string; value: string }[]> {
  const courses = await todayCourses(ctx.now);
  const logs = await getSleepLogs();
  const lastNight = lastNightSleep(logs);
  const avg7 = avgSleepHours(logs, 7);
  // 没有录入记录时不要把「健康基线 8h」当实测值展示（真实模式首跑会撞上）
  const avg7Text = logs.length === 0 ? '—（尚未录入）' : `${avg7.toFixed(1)}h`;
  const todayStr = ctx.now.toDateString();
  const choicesToday = (await db.choices.toArray()).filter((c) => new Date(c.at).toDateString() === todayStr).length;
  return [
    { label: '今日课程', value: `${courses.length} 节` },
    { label: '昨晚睡眠', value: lastNight ? `${lastNight.hours}h` : '—（尚未录入）' },
    { label: '近 7 天平均睡眠', value: avg7Text },
    { label: '今日点选', value: `${choicesToday} 个选项（已记入本地偏好）` },
  ];
}

async function buildPreview(ctx: AgentContext): Promise<string[]> {
  const dow = dayOfWeek(ctx.now);
  const tomorrowDow = ((dow % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const tomorrow = await coursesOfDay(tomorrowDow);
  const items: string[] = [];

  if (tomorrow.length === 0) {
    items.push('明天没有课，可以睡到自然醒');
  } else {
    const first = tomorrow[0];
    items.push(
      first.startMin <= 480
        ? `早八预警：明早 ${fmtMin(first.startMin)}「${first.name}」（${first.location}）`
        : `明天第一节 ${fmtMin(first.startMin)}「${first.name}」（${first.location}）`,
    );
    if (tomorrow.some((c) => c.name.includes('体育'))) items.push('明天有体育课：记得带运动服和水杯');
    if (tomorrow.some((c) => c.name.includes('实验') || c.name.includes('数据'))) items.push('带好课本、笔记本和实验报告');
  }
  items.push('夜间转凉：明早出门建议带薄外套');
  return items.slice(0, 3);
}

export async function composeReport(
  type: ReportType,
  results: AgentResult[],
  suggestions: Suggestion[],
  conflicts: ConflictCard[],
  ctx: AgentContext,
): Promise<Report> {
  const slot = SLOT_OF[type];
  const slotSuggestions = suggestions
    .filter((s) => slot === null || s.slot === slot)
    .sort((a, b) => a.priority - b.priority);
  const warnings = results.flatMap((r) => r.findings).filter((f) => f.type === 'warning');
  const facts = results.flatMap((r) => r.findings);

  const blocks: ReportBlock[] = [];
  for (const kind of RECIPES[type]) {
    switch (kind) {
      case 'overview':
        blocks.push({ kind: 'overview', items: await buildOverview(type, results, ctx) });
        break;
      case 'suggestionGroup':
        for (const suggestion of slotSuggestions) blocks.push({ kind: 'suggestionGroup', suggestion });
        break;
      case 'conflict':
        for (const conflict of conflicts) blocks.push({ kind: 'conflict', conflict });
        break;
      case 'warning':
        for (const w of warnings) blocks.push({ kind: 'warning', text: w.summary, agentId: w.evidences?.[0]?.agentId ?? 'schedule' });
        break;
      case 'recap':
        blocks.push({ kind: 'recap', stats: { items: await buildRecap(ctx) } });
        break;
      case 'preview':
        blocks.push({ kind: 'preview', items: await buildPreview(ctx) });
        break;
      case 'checklist': {
        const examTitle = facts.find((f) => f.id === 'exam:title')?.summary ?? '考试';
        blocks.push({
          kind: 'checklist',
          title: `${examTitle} · 考场物品清单`,
          items: examEveChecklist(examTitle),
        });
        break;
      }
    }
  }
  return { type, generatedAt: ctx.now, blocks };
}
