import { avgSleepHours, computeTimeBlocks, coursesOfDay, describeBlocks, lastNightSleep } from '@/data/queries';
import { getSleepLogs } from '@/data/store/profile';
import { dayOfWeek } from '@/types/contract';
import type {
  AgentContext,
  AgentResult,
  ConflictClaim,
  ExamItem,
  Finding,
  Suggestion,
} from '@/types/contract';
import { countdownText, masteryAdvice, type ExamWindow } from '@/lib/examMode';
import { collectTopicStats } from './compliance';

/**
 * 生存模式注入层（dev-tasks A6）
 *
 * 设计取舍：**不改动** academic / health / schedule 三个 Agent 的内部实现，
 * 而是在编排器汇总阶段把「生存模式专属产出」作为一等 AgentResult 注入 results 数组。
 * 好处：普通报告的链路零风险；生存模式的规则集中在这一个文件里，删掉即回滚。
 *
 * 注入内容：
 *   1. academic：倒计时 fact + 考前 3 天内的 warning（compose 的「风险项」会因此变色）
 *   2. schedule：按 ExamItem.mastery 生成的复习计划选项卡（整块 / 碎片 / 刷题三条路）
 *   3. health × schedule：考前一晚的「保底睡眠」L2 冲突卡（两条主张配对，用户拍板）
 */

/** 生存模式下的 Agent 权重（契约 AgentModule.defaultWeight 的「动态调整」落地处） */
const EXAM_WEIGHT: Record<'academic' | 'life' | 'health' | 'schedule', number> = {
  academic: 1.2,
  life: 1.0,
  health: 1.3,
  schedule: 1.4,
};

/** 权重 ≥1.3 的建议整体上浮一级优先级（1 最紧急） */
function priorityWithWeight(base: 1 | 2 | 3, weight: number): 1 | 2 | 3 {
  const lifted = weight >= 1.3 ? base - 1 : base;
  return Math.max(1, Math.min(3, lifted)) as 1 | 2 | 3;
}

/** 掌握度 → 基准优先级：越不熟越靠前 */
function priorityOfMastery(mastery: ExamItem['mastery']): 1 | 2 | 3 {
  if (mastery === undefined) return 2;
  if (mastery <= 2) return 1;
  if (mastery === 3) return 2;
  return 3;
}

/** 每门考试给三条复习路径（整块 / 碎片 / 刷题），按掌握度决定顺序与话术 */
function reviewSuggestionOf(exam: ExamItem, now: Date): Suggestion {
  const mastery = exam.mastery;
  const drillsFirst = (mastery ?? 3) >= 4;
  const days = countdownText(exam, now);
  const weight = EXAM_WEIGHT.schedule;

  const blockOption = {
    id: `${exam.id}-block`,
    title: '今晚留一个 90 分钟整块，只攻这一门',
    cost: { timeMin: 90 },
    pros: ['连续上下文，适合建立章节框架', masteryAdvice(mastery)],
    cons: ['今晚别的安排要让路'],
    impacts: [
      { horizon: 'short' as const, text: '今晚进度明显推进，但会更累', agentId: 'schedule' as const },
      { horizon: 'long' as const, text: '考前不慌的概率更高', agentId: 'schedule' as const },
    ],
    evidences: [
      { agentId: 'schedule' as const, text: `${exam.title}：${days}`, confidence: 3 as const },
      { agentId: 'schedule' as const, text: masteryAdvice(mastery), confidence: 2 as const },
    ],
  };

  const fragmentOption = {
    id: `${exam.id}-fragment`,
    title: '拆成 3 个 30 分钟碎片（课间 / 排队 / 睡前）',
    cost: { timeMin: 90 },
    pros: ['不占整块，抗打断', '记忆类内容（单词、公式）适合碎片'],
    cons: ['每次都要重新进入状态，深度不够'],
    impacts: [
      { horizon: 'short' as const, text: '今天能挤出复习量，但理解深度有限', agentId: 'schedule' as const },
      { horizon: 'long' as const, text: '只适合记忆型科目，纯理解型收效低', agentId: 'schedule' as const },
    ],
    evidences: [{ agentId: 'schedule' as const, text: '碎片 <2h，按设计文档 §4.8 优先塞记忆类', confidence: 2 as const }],
  };

  const drillOption = {
    id: `${exam.id}-drill`,
    title: '先做一套往年题，用错题反推要看的章节',
    cost: { timeMin: 60 },
    pros: ['先暴露不会的地方，避免无效通读', '有明确完成标志'],
    cons: ['基础太薄时容易挫败'],
    impacts: [
      { horizon: 'short' as const, text: '一小时就知道该看哪几章', agentId: 'schedule' as const },
      { horizon: 'long' as const, text: '考前手感更接近真实考场', agentId: 'schedule' as const },
    ],
    evidences: [{ agentId: 'schedule' as const, text: '掌握度 ≥4 时刷题收益高于通读', confidence: 2 as const }],
  };

  return {
    id: `sug-exam-${exam.id}`,
    topic: `${exam.title} 复习`,
    priority: priorityWithWeight(priorityOfMastery(mastery), weight),
    slot: 'evening',
    sourceFindingIds: ['exam:countdown'],
    options: (drillsFirst
      ? [drillOption, blockOption, fragmentOption]
      : [blockOption, fragmentOption, drillOption]) as Suggestion['options'],
  };
}

/** 考前一晚的保底睡眠冲突：健康主张「按点睡」× 日程主张「再刷一小时」 */
function examEveClaims(
  exam: ExamItem,
  ctx: AgentContext,
  lastNightHours: number,
): ConflictClaim[] {
  const topic = '考前一晚';
  const poorSleep = lastNightHours > 0 && lastNightHours < 6.5;

  const sleepPlan = {
    agentId: 'health' as const,
    id: 'eve-sleep',
    title: '按原计划睡（保 7 小时以上），明早再看 30 分钟错题',
    cost: { timeMin: 0 },
    pros: [
      poorSleep ? `昨晚只睡 ${lastNightHours}h，今晚再压缩会滚雪球` : '睡眠是明天注意力的本金',
      '记忆巩固发生在睡眠里，熬夜复习的边际收益最低',
    ],
    cons: ['今晚少复习约 1 小时'],
    impacts: [
      { horizon: 'long' as const, text: `明早「${exam.title}」前两小时注意力在线`, agentId: 'health' as const },
      { horizon: 'long' as const, text: '考完不进入连续缺觉状态', agentId: 'health' as const },
    ],
    evidences: [
      { agentId: 'health' as const, text: `近一晚睡眠 ${lastNightHours || '—'}h`, confidence: 2 as const },
      { agentId: 'health' as const, text: masteryAdvice(exam.mastery), confidence: 1 as const },
    ],
  };

  const cramPlan = {
    agentId: 'schedule' as const,
    id: 'eve-cram',
    title: '再看 1 小时（只过错题，不碰新内容）',
    cost: { timeMin: 60 },
    pros: ['把最近一次错题再过一遍，短期记忆还有用'],
    cons: ['少睡 1 小时，明早注意力下降', '容易越看越慌，把 1 小时拖成 2 小时'],
    impacts: [
      { horizon: 'short' as const, text: '明早前两小时犯困概率明显升高', agentId: 'health' as const },
      { horizon: 'long' as const, text: '连续三天缺觉会拖垮整周的复习效率', agentId: 'health' as const },
    ],
    evidences: [{ agentId: 'schedule' as const, text: `距「${exam.title}」${countdownText(exam, ctx.now)}`, confidence: 3 as const }],
  };

  return [
    { topic, side: 'sleep', plan: sleepPlan },
    { topic, side: 'cram', plan: cramPlan },
  ];
}

/**
 * 生存模式的全部注入产出。
 * @param w 由 examWindowOf() 算出的窗口；调用方保证 w.mode === 'exam'
 */
export async function buildExamResults(ctx: AgentContext, w: ExamWindow): Promise<AgentResult[]> {
  const now = ctx.now;
  const next = w.nextExam;
  if (!next) return [];

  const logs = await getSleepLogs();
  const avg7 = avgSleepHours(logs, 7, now);
  const lastNight = lastNightSleep(logs, now)?.hours ?? 0;

  const blocks = describeBlocks(computeTimeBlocks(await coursesOfDay(dayOfWeek(now))));

  const findings: Finding[] = [
    {
      id: 'exam:countdown',
      type: 'fact',
      topic: '考试',
      confidence: 3,
      summary: `「${next.title}」${countdownText(next, now)}`,
      evidences: [{ agentId: 'academic', text: `考前 7 天进入生存模式，当前第 ${7 - (w.daysToExam ?? 0)} 天`, confidence: 3 }],
    },
    {
      id: 'exam:blocks',
      type: 'fact',
      topic: '复习',
      confidence: 2,
      summary: `今天可用的复习窗口：${blocks}`,
      evidences: [{ agentId: 'schedule', text: '按课表切出的整块 / 碎片', confidence: 2 }],
    },
    {
      // 供 compose 的 checklist 分支取考试名（考场清单卡片标题用）
      id: 'exam:title',
      type: 'fact',
      topic: '考试',
      confidence: 3,
      summary: next.title,
      evidences: [{ agentId: 'academic', text: '来自本地考试表的最近一场', confidence: 3 }],
    },
  ];

  if (w.daysToExam !== null && w.daysToExam <= 3) {
    findings.push({
      id: 'exam:lead',
      type: 'warning',
      topic: '考试',
      confidence: 3,
      summary: `${w.daysToExam === 0 ? '今天就是考试日' : `距「${next.title}」只剩 ${w.daysToExam} 天`}，今晚空档建议整体让给复习`,
      evidences: [{ agentId: 'academic', text: countdownText(next, now), confidence: 3 }],
    });
  }

  if (avg7 !== null && avg7 < 6.5) {
    findings.push({
      id: 'exam:sleep-debt',
      type: 'warning',
      topic: '睡眠',
      confidence: 2,
      summary: `近 7 天平均睡眠 ${avg7.toFixed(1)}h，冲刺期继续缺觉会让记忆巩固打折`,
      evidences: [{ agentId: 'health', text: '连续缺觉 × 高强度复习 = 效率坍塌', confidence: 2 }],
    });
  }

  // 1) 教务：倒计时事实（compose 的 overview 会读 exam:countdown）
  const academic: AgentResult = { agentId: 'academic', findings };

  // 2) 日程：复习计划选项卡（最多同时给两门，避免报告过长）
  const reviewTargets = w.upcoming.filter((e) => e.kind === 'exam').slice(0, 2);
  const schedule: AgentResult = {
    agentId: 'schedule',
    findings: [],
    suggestions: reviewTargets.map((e) => reviewSuggestionOf(e, now)),
  };

  // 3) 健康：保底睡眠冲突只在考前夜 / 考试日给（其余时间不打扰）
  const health: AgentResult = {
    agentId: 'health',
    findings: [],
    conflictClaims: w.daysToExam !== null && w.daysToExam <= 1 ? examEveClaims(next, ctx, lastNight) : [],
  };

  return [academic, schedule, health];
}

/**
 * 考场物品清单（供 compose.ts 的 checklist 分支调用）
 * 与考试科目无关的部分写死，避免为一句话改契约；科目相关的两条按考试标题生成。
 */
export function examEveChecklist(examTitle: string): string[] {
  return [
    '学生证 / 身份证（放书包最外层）',
    '2B 铅笔 ×2 + 橡皮 + 黑色签字笔 ×2',
    '手表（手机按考场要求关机放包）',
    '水杯（撕掉外包装，放桌角）',
    `「${examTitle}」的 A4 公式纸 / 单词卡（考前 10 分钟看）`,
  ];
}

// ── 考后小结（B10）────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 考后小结：某一门刚考完（开考 2h ~ 6h 之间）时，报告从「冲刺」切到「复盘」。
 *
 * 三个数字都来自真实记录，不估算：
 * - 考前一晚睡了几小时（sleepLogs 里考试当天那条）
 * - 复习建议给过几次、真正标了「做了」几次（compliance 表，主题含「复习」）
 * - 下一场在什么时候（exams 表）
 */
export async function buildExamDoneResults(
  ctx: AgentContext,
  exam: ExamItem,
  allExams: ExamItem[],
): Promise<AgentResult[]> {
  const start = new Date(exam.at);
  const hhmm = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const findings: Finding[] = [];

  findings.push({
    id: 'exam:done',
    type: 'fact',
    topic: '考试',
    confidence: 3,
    summary: `《${exam.title}》已考完 · 今天 ${hhmm} 开考`,
  });

  // 复习执行：只数「复习」类主题，不把午饭、小憩那些算进来
  const stats = await collectTopicStats();
  const review = [...stats.values()].filter((s) => s.topic.includes('复习'));
  const shown = review.reduce((n, s) => n + s.shown, 0);
  const done = review.reduce((n, s) => n + s.done, 0);
  findings.push({
    id: 'exam:review',
    type: 'fact',
    topic: '复习',
    confidence: shown > 0 ? 3 : 0,
    summary: shown === 0 ? '这次的复习建议没留下执行记录' : `复习建议给过 ${shown} 次，你标了 ${done} 次「做了」`,
  });

  const logs = await getSleepLogs();
  const eveLog = logs.find((l) => l.date === isoDate(start));
  findings.push({
    id: 'exam:sleep-night',
    type: 'fact',
    topic: '睡眠',
    confidence: eveLog ? 3 : 0,
    summary: eveLog ? `考前一晚睡了 ${eveLog.hours}h` : '考前一晚没有睡眠记录',
  });

  const next = allExams.find((e) => new Date(e.at).getTime() > ctx.now.getTime());
  findings.push({
    id: 'exam:next',
    type: 'fact',
    topic: '考试',
    confidence: 2,
    summary: next ? `下一场《${next.title}》：${countdownText(next, ctx.now)}` : '这个学期暂时没有别的考试',
  });

  if (eveLog && eveLog.hours < 6) {
    findings.push({
      id: 'exam:done-fatigue',
      type: 'warning',
      topic: '睡眠',
      confidence: 2,
      summary: `考前一晚只睡了 ${eveLog.hours}h，今天下午的注意力会打折，别把需要动脑的事排在晚上`,
    });
  }

  // 一条建议就够：考完当晚别从一个极端跳到另一个极端
  const recover: Suggestion = {
    id: 'sug-exam-recover',
    topic: '考完这一晚',
    priority: 2,
    slot: 'evening',
    sourceFindingIds: ['exam:done', 'exam:sleep-night'],
    options: [
      {
        id: 'recover-sleep',
        title: '早点睡，把欠的补回来',
        cost: { timeMin: 0 },
        pros: ['连续几天的睡眠债，这时候回本最有效'],
        cons: ['今晚的娱乐时间要让路'],
        impacts: [{ horizon: 'short', text: '明天白天精神明显好转', agentId: 'health' }],
        evidences: eveLog ? [{ agentId: 'health', text: `考前一晚 ${eveLog.hours}h`, confidence: 3 }] : [],
      },
      {
        id: 'recover-play',
        title: '先玩两小时再说',
        cost: { timeMin: 120 },
        pros: ['考完需要放松，硬撑着也学不进去'],
        cons: ['补觉时间整体推迟两小时'],
        impacts: [{ horizon: 'short', text: '明天起床时间会被往后推', agentId: 'health' }],
        evidences: [{ agentId: 'health', text: '放松本身没错，代价只是推迟入睡', confidence: 2 }],
      },
      {
        id: 'recover-normal',
        title: '照常作息，什么也不改',
        cost: { timeMin: 0 },
        pros: ['不打破已经形成的节奏'],
        cons: ['睡眠债继续滚到下一周'],
        impacts: [{ horizon: 'long', text: '下周的精力起点还是偏低的', agentId: 'health' }],
        evidences: [],
      },
    ],
  };

  return [
    { agentId: 'academic', findings },
    { agentId: 'health', findings: [], suggestions: [recover] },
  ];
}

