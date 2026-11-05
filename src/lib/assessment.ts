import type { HabitTraits } from '@/types/contract';

/**
 * 任务习惯倾向测评（12 题，2 分钟）
 *
 * 不是人格测试，也不下诊断：每一题只为了给排期算法定一个数。
 * 四个维度各 3 题，每题 -1 / 0 / +1，原始分落在 -3..3，阈值集中在这里，方便以后调。
 */

type Dimension = 'rhythm' | 'structure' | 'focus' | 'drive';

export interface AssessmentChoice {
  label: string;
  score: number;
}

export interface AssessmentQuestion {
  id: string;
  dim: Dimension;
  text: string;
  choices: AssessmentChoice[];
}

export const QUESTIONS: AssessmentQuestion[] = [
  {
    id: 'q1',
    dim: 'rhythm',
    text: '没课的上午，你几点才真正清醒？',
    choices: [
      { label: '八点前就清醒了，上午能干正事', score: 1 },
      { label: '十点以后才进入状态', score: -1 },
    ],
  },
  {
    id: 'q2',
    dim: 'rhythm',
    text: '同样的复习量，哪个时段你效率更高？',
    choices: [
      { label: '上午 8:00–11:00', score: 1 },
      { label: '晚上 20:00 以后', score: -1 },
    ],
  },
  {
    id: 'q3',
    dim: 'rhythm',
    text: '早八课之后的那半天，你通常是？',
    choices: [
      { label: '还行，上午还能接着干活', score: 1 },
      { label: '基本废掉，得靠午睡救回来', score: -1 },
    ],
  },
  {
    id: 'q4',
    dim: 'structure',
    text: '一周的任务，你更习惯怎么放？',
    choices: [
      { label: '先排进日历，按计划走', score: 1 },
      { label: '大概知道，当天看状态再说', score: -1 },
    ],
  },
  {
    id: 'q5',
    dim: 'structure',
    text: '开始复习一门课，你通常先做什么？',
    choices: [
      { label: '先定目标、切成几块，再动手', score: 1 },
      { label: '直接翻开书，边做边调整', score: -1 },
    ],
  },
  {
    id: 'q6',
    dim: 'structure',
    text: '计划被临时的事情打乱时，你？',
    choices: [
      { label: '会不舒服，想马上重新排一遍', score: 1 },
      { label: '无所谓，重新安排就是了', score: -1 },
    ],
  },
  {
    id: 'q7',
    dim: 'focus',
    text: '你能连续专注多久不看手机？',
    choices: [
      { label: '25 分钟左右就得歇一下', score: -1 },
      { label: '45–60 分钟没问题', score: 0 },
      { label: '90 分钟以上才过瘾', score: 1 },
    ],
  },
  {
    id: 'q8',
    dim: 'focus',
    text: '一大块任务摆在你面前，你更愿意？',
    choices: [
      { label: '拆成几段，每段不超过半小时', score: -1 },
      { label: '一次一小时，中间不用停', score: 0 },
      { label: '越长越好，进入状态不容易', score: 1 },
    ],
  },
  {
    id: 'q9',
    dim: 'focus',
    text: '手机放在旁边时，你的状态是？',
    choices: [
      { label: '会忍不住看，得物理隔离', score: -1 },
      { label: '偶尔看一眼，影响不大', score: 0 },
      { label: '基本不看，能自己屏蔽', score: 1 },
    ],
  },
  {
    id: 'q10',
    dim: 'drive',
    text: '一份两周后截止的作业，你通常？',
    choices: [
      { label: '截止前那几天集中做', score: -1 },
      { label: '发下来就开始，分批推进', score: 1 },
    ],
  },
  {
    id: 'q11',
    dim: 'drive',
    text: '睡前突然想起还有个 DDL，你？',
    choices: [
      { label: '得爬起来干一点才睡得着', score: -1 },
      { label: '记下来，明天按计划做', score: 1 },
    ],
  },
  {
    id: 'q12',
    dim: 'drive',
    text: '别人催你进度，你的真实反应是？',
    choices: [
      { label: '有点用，会推我一把', score: -1 },
      { label: '反而烦，想按自己的节奏来', score: 1 },
    ],
  },
];

export type Answers = Record<string, number>;

function sumOf(answers: Answers, dim: Dimension): number {
  let sum = 0;
  for (const q of QUESTIONS) {
    if (q.dim !== dim) continue;
    const s = answers[q.id];
    if (typeof s === 'number') sum += s;
  }
  return sum;
}

/** 把 12 个答案折成四维画像；没答的题按 0 计 */
export function scoreAnswers(answers: Answers): HabitTraits {
  const rhythm = sumOf(answers, 'rhythm');
  const structure = sumOf(answers, 'structure');
  const focusScore = sumOf(answers, 'focus');
  const drive = sumOf(answers, 'drive');

  return {
    rhythm: rhythm >= 0 ? 'morning' : 'night',
    structure: structure >= 0 ? 'planner' : 'flexible',
    focus: focusScore <= -1 ? 'sprint' : focusScore >= 1 ? 'deep' : 'steady',
    drive: drive <= -1 ? 'deadline' : 'steady',
    takenAt: new Date().toISOString(),
    scores: { rhythm, structure, focus: focusScore, drive },
  };
}

/** 排期参数：每个维度只映射到一个真正会被读到的数 */
export interface TraitEffects {
  /** 单块复习时长（分钟） */
  focusMinutes: number;
  /** 排期向前看几天 */
  horizonDays: number;
  /** 每天最多安排多少分钟复习 */
  dayBudget: number;
  /** 优先时段 */
  preferSlot: 'morning' | 'evening' | 'any';
}

const FOCUS_MINUTES: Record<HabitTraits['focus'], number> = { sprint: 30, steady: 60, deep: 90 };

export function effectsOf(traits: HabitTraits): TraitEffects {
  const focusMinutes = FOCUS_MINUTES[traits.focus];
  // 计划型愿意提前铺开；压线型提前排了也不会执行，所以压到 3 天
  let horizonDays = traits.structure === 'planner' ? 6 : 4;
  if (traits.drive === 'deadline') horizonDays = Math.min(horizonDays, 3);
  if (traits.drive === 'steady' && traits.focus === 'deep') horizonDays += 1;
  horizonDays = Math.min(7, Math.max(3, horizonDays));

  // 每天配额：短跑型更适合分两次、每次半小时；长跑型一次吃掉一个整块
  const dayBudget = traits.focus === 'sprint' ? 60 : traits.focus === 'deep' ? 120 : 90;

  return {
    focusMinutes,
    horizonDays,
    dayBudget,
    preferSlot: traits.rhythm === 'morning' ? 'morning' : 'evening',
  };
}

export const TRAIT_LABEL: Record<string, string> = {
  morning: '早间型',
  night: '夜间型',
  planner: '计划型',
  flexible: '弹性型',
  sprint: '短跑型',
  steady: '匀速型',
  deep: '长跑型',
  deadline: '压线型',
};

export const TRAIT_NOTE: Record<string, string> = {
  morning: '上午脑力最好。重要的事往后拖到晚上，等于用最差的自己干最难的活。',
  night: '晚上才真正开机。别逼自己早起做难题，那段时间只适合低强度的事。',
  planner: '先有框架才安心。提前几天把草案排出来，比当天现想更省力。',
  flexible: '计划太细反而抗拒。给你短草案 + 手动重排，比一张排满的表有用。',
  sprint: '25–30 分钟一段最舒服。硬凑一小时，后半段基本是坐着。',
  steady: '45–60 分钟一段，节奏稳。太长反而会走神。',
  deep: '90 分钟整块才进入状态。切碎了反而一直在热身。',
  deadline: '截止日驱动。排太早等于白排，不如把力气留到临近那几天。',
};

/** 一行摘要，给画像卡和报告用 */
export function traitsLine(traits: HabitTraits): string {
  return [TRAIT_LABEL[traits.rhythm], TRAIT_LABEL[traits.structure], TRAIT_LABEL[traits.focus], TRAIT_LABEL[traits.drive]].join(' · ');
}
