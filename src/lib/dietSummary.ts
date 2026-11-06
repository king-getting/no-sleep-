import type { DirectionId, MealNutrition } from '@/types/contract';
import type { ChoiceRecord } from '@/data/store/db';

/**
 * 饮食总结（健康页）
 *
 * 数据来源只有一处：你在报告里点过的选项卡。点一次就落一条快照
 * （标题 / 价格 / 营养结构），这里只是把今天这些点选算成三个 方向 的看法。
 *
 * 三条评分维度分别由三个 方向 出：
 *   健康 —— 结构（蔬菜 / 蛋白质 / 油）
 *   生活 —— 钱（今日花费 vs 日餐标）
 *   日程 —— 时间（有没有跳过早饭、是不是拖到很晚才吃）
 *
 * 分数是给人看的刻度，不是营养测量值；每条都附「为什么」和「下一步」，
 * 避免变成一个只有数字的黑箱。
 */

export interface DietMeal {
  topic: string;
  title: string;
  at: Date;
  price?: number;
  nutrition?: MealNutrition;
}

export interface DietDimension {
  directionId: DirectionId;
  label: string;
  score: number;
  reason: string;
  tip: string;
}

export interface DietSummary {
  score: number;
  grade: string;
  gradeTone: 'good' | 'ok' | 'tight';
  dims: DietDimension[];
  meals: DietMeal[];
  spend: number;
  budget: number;
  /** 还没点过任何一顿：健康页要给出「去报告里点一顿」的空态，而不是编数据 */
  isEmpty: boolean;
}

interface Meta {
  title?: string;
  price?: number;
  nutrition?: MealNutrition;
  note?: string;
}

function readMeta(record: ChoiceRecord): Meta {
  if (!record.meta) return {};
  try {
    return JSON.parse(record.meta) as Meta;
  } catch {
    return {};
  }
}

const MEAL_ORDER = ['早饭', '早餐', '午饭', '午餐', '晚饭', '晚餐', '夜宵'];

/** 只有「吃饭」这一类点选进饮食总结：复习、睡觉的选项卡不掺进来 */
const MEAL_TOPIC = /早饭|早餐|午饭|午餐|晚饭|晚餐|夜宵|吃饭|早午餐/;

function mealRank(topic: string): number {
  const hit = MEAL_ORDER.findIndex((k) => topic.includes(k));
  return hit < 0 ? 99 : hit;
}

/** 合理用餐时段（分钟），超出就扣分：太早或太晚都不是「按时吃饭」 */
function mealWindow(topic: string): { start: number; end: number; hardEnd: number } | null {
  if (/早/.test(topic)) return { start: 6 * 60, end: 9 * 60 + 30, hardEnd: 10 * 60 };
  if (/午/.test(topic)) return { start: 10 * 60 + 30, end: 13 * 60 + 30, hardEnd: 14 * 60 + 30 };
  if (/晚|夜宵/.test(topic)) return { start: 16 * 60 + 30, end: 19 * 60 + 30, hardEnd: 21 * 60 };
  return null;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function buildDietSummary(records: ChoiceRecord[], budget: number): DietSummary {
  const meals: DietMeal[] = records
    .filter((r) => MEAL_TOPIC.test(r.topic))
    .map((r) => {
      const meta = readMeta(r);
      return {
        topic: r.topic,
        title: meta.title ?? r.optionId,
        at: new Date(r.at),
        price: typeof meta.price === 'number' ? meta.price : undefined,
        nutrition: meta.nutrition,
      };
    })
    .sort((a, b) => mealRank(a.topic) - mealRank(b.topic) || a.at.getTime() - b.at.getTime());

  if (meals.length === 0) {
    return {
      score: 0,
      grade: '还没开张',
      gradeTone: 'ok',
      dims: [],
      meals,
      spend: 0,
      budget,
      isEmpty: true,
    };
  }

  // ---- 健康：营养结构 ----
  const withNutrition = meals.filter((m) => m.nutrition);
  const avg = (pick: (n: MealNutrition) => number) =>
    withNutrition.length === 0 ? 0 : withNutrition.reduce((s, m) => s + pick(m.nutrition as MealNutrition), 0) / withNutrition.length;
  const veg = avg((n) => n.veg);
  const protein = avg((n) => n.protein);
  const oil = avg((n) => n.oil);
  const healthScore = withNutrition.length === 0 ? 55 : clamp(((veg * 0.45 + protein * 0.35 + oil * 0.2) / 2) * 100);

  const oilMeals = withNutrition.filter((m) => (m.nutrition as MealNutrition).oil === 0).length;
  const lightMeals = withNutrition.filter((m) => (m.nutrition as MealNutrition).veg === 2).length;
  const healthReason =
    withNutrition.length === 0
      ? '这几顿没有营养结构信息，只能按「有没有吃」给一个中性分。'
      : `蔬菜 ${['没有', '偏少', '到位'][Math.round(veg)]}、蛋白质 ${['偏少', '够', '充足'][Math.round(protein)]}、油 ${['偏重', '适中', '偏轻'][Math.round(oil)]}；${withNutrition.length} 顿里有 ${oilMeals} 顿油偏重。`;
  const healthTip =
    oilMeals > 0
      ? '下一顿把油炸换成一份炒青菜：同样的钱，下午不犯困的概率高很多。'
      : lightMeals > 0
        ? '结构已经不错了，保持「一荤两素」这个组合就行。'
        : '加一份便宜的素菜（清炒时蔬通常 3–5 元），比换食堂划算。';

  // ---- 生活：花销 ----
  const spend = meals.reduce((s, m) => s + (m.price ?? 0), 0);
  const priced = meals.filter((m) => typeof m.price === 'number').length;
  const ratio = budget > 0 ? spend / budget : 0;
  const lifeScore = priced === 0 ? 60 : ratio <= 0.6 ? 92 : ratio <= 0.85 ? 86 : ratio <= 1 ? 78 : clamp(78 - (ratio - 1) * 100, 20, 78);
  const left = Math.round((budget - spend) * 10) / 10;
  const lifeReason =
    priced === 0
      ? '这几顿没记到价格，花销这块先不评。'
      : `今天吃了 ¥${spend}，日餐标 ¥${budget}，${left >= 0 ? `还剩 ¥${left}` : `超出 ¥${Math.abs(left)}`}。`;
  const lifeTip =
    left < 0
      ? '晚上那顿往 8 元的窗口靠，把超出的部分吃回来，比明天少吃一顿更实际。'
      : ratio > 0.85
        ? '今天已经接近餐标上限，夜宵就别点了。'
        : '照这个节奏，月底不会出现「后十天只吃泡面」的情况。';

  // ---- 日程：时间 ----
  let timePenalty = 0;
  const timeNotes: string[] = [];
  const hasBreakfast = meals.some((m) => /早/.test(m.topic));
  if (!hasBreakfast) {
    timePenalty += 22;
    timeNotes.push('今天没记早饭');
  }
  for (const m of meals) {
    const win = mealWindow(m.topic);
    if (!win) continue;
    const minutes = m.at.getHours() * 60 + m.at.getMinutes();
    if (minutes > win.hardEnd) {
      timePenalty += 18;
      timeNotes.push(`${m.topic}拖到 ${String(m.at.getHours()).padStart(2, '0')}:${String(m.at.getMinutes()).padStart(2, '0')}`);
    } else if (minutes > win.end) {
      timePenalty += 8;
    }
  }
  const timeScore = clamp(96 - timePenalty);
  const timeReason =
    timeNotes.length === 0
      ? `三餐时间都在正常窗口里（${meals.length} 顿都有记录）。`
      : `${timeNotes.join('、')}；吃饭时间一乱，午后的状态最先掉。`;
  const timeTip = hasBreakfast
    ? '时间这块问题不大，明天保持就行。'
    : '早饭哪怕只是一个包子也记一笔——跳过早饭的人，中午更容易吃撑。';

  const dims: DietDimension[] = [
    { directionId: 'health', label: '营养结构', score: healthScore, reason: healthReason, tip: healthTip },
    { directionId: 'life', label: '日常花销', score: lifeScore, reason: lifeReason, tip: lifeTip },
    { directionId: 'schedule', label: '用餐时间', score: timeScore, reason: timeReason, tip: timeTip },
  ];

  const score = clamp(dims.reduce((s, d) => s + d.score, 0) / dims.length);
  const grade = score >= 85 ? '很稳' : score >= 70 ? '及格' : score >= 55 ? '凑合' : '偏紧';
  const gradeTone = score >= 85 ? 'good' : score >= 60 ? 'ok' : 'tight';

  return { score, grade, gradeTone, dims, meals, spend, budget, isEmpty: false };
}
