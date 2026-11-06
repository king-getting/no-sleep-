import type { FactBundle } from '@/lib/facts';

/**
 * 简报生成层
 *
 * 生成器只拿到 FactBundle，产出结构化的 Brief；每个论点必须挂 factIds。
 * 上屏前统一跑 validateBrief：引用不存在、字段超长、空文本都判失败，
 * 失败自动回落到模板——未通过校验的文本永远不会出现在界面上。
 *
 * 现在只有 template 生成器；接大模型时新增一个实现同一接口的 generator，
 * 校验、兜底、缓存都不用改。
 */

export type BriefAngle = 'academic' | 'life' | 'health' | 'schedule';

export interface BriefPoint {
  text: string;
  /** 这条结论出自哪个方向的分析（模型生成时必填，模板可省略） */
  angle?: BriefAngle;
  /** 这条结论依据的事实 id，必须存在于 FactBundle */
  factIds: string[];
}

export interface Brief {
  headline: string;
  points: BriefPoint[];
  advice: string;
  generatedBy: 'template' | 'model';
  generatedAt: string;
}

export interface BriefValidation {
  ok: boolean;
  errors: string[];
}

const MAX_HEADLINE = 40;
const MAX_POINT = 60;
const MAX_ADVICE = 60;
const MIN_POINTS = 1;
const MAX_POINTS = 4;

export function validateBrief(brief: Brief, bundle: FactBundle): BriefValidation {
  const errors: string[] = [];
  if (!brief.headline.trim()) errors.push('headline 为空');
  if (brief.headline.length > MAX_HEADLINE) errors.push('headline 超长');
  if (!brief.advice.trim()) errors.push('advice 为空');
  if (brief.advice.length > MAX_ADVICE) errors.push('advice 超长');
  if (brief.points.length < MIN_POINTS) errors.push('没有论点');
  if (brief.points.length > MAX_POINTS) errors.push('论点过多');

  brief.points.forEach((p, i) => {
    if (!p.text.trim()) errors.push(`第 ${i + 1} 条为空`);
    if (p.text.length > MAX_POINT) errors.push(`第 ${i + 1} 条超长`);
    if (!p.factIds.length) errors.push(`第 ${i + 1} 条没有引用`);
    for (const id of p.factIds) {
      if (!bundle.byId[id]) errors.push(`第 ${i + 1} 条引用了不存在的事实：${id}`);
    }
  });

  return { ok: errors.length === 0, errors };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 模板生成器：确定性、可离线、永远可用 */
export function composeBrief(bundle: FactBundle, now: Date): Brief {
  const { summary } = bundle;
  const { today, tomorrow, nextExam, lastNight, week } = summary;
  const points: BriefPoint[] = [];

  const firstToday = today.courses[0];
  const earlyClass = firstToday && firstToday.startMin <= 8 * 60 + 30;
  const shortSleep = lastNight && lastNight.hours < 6.5;

  // 1. 早八 + 缺觉：最值得先说的一条
  if (firstToday && earlyClass && shortSleep && lastNight) {
    points.push({
      text: `${hhmm(firstToday.startMin)} 有${firstToday.name}，昨晚只睡了 ${lastNight.hours} 小时`,
      factIds: [`course-today-${firstToday.id}`, `sleep-${lastNight.date}`],
    });
  } else if (firstToday) {
    points.push({
      text: `今天 ${today.courses.length} 节课，${hhmm(firstToday.startMin)} 开始`,
      factIds: [`course-today-${firstToday.id}`],
    });
  } else {
    points.push({ text: '今天没有课', factIds: ['week-courses'] });
  }

  // 2. 最近考试
  if (nextExam && nextExam.days <= 7) {
    points.push({
      text: `${nextExam.title}还有 ${nextExam.days} 天`,
      factIds: [`exam-${nextExam.id}`],
    });
  }

  // 3. 今天的空档
  const gap = today.freeBlocks.find((g) => g.endMin - g.startMin >= 90);
  if (gap) {
    points.push({
      text: `${hhmm(gap.startMin)}–${hhmm(gap.endMin)} 空着，可以排一块复习`,
      factIds: ['free-today-0', 'week-review'],
    });
  }

  // 4. 本周复习进度
  if (week.reviewPlanned > 0 && week.reviewDone < week.reviewPlanned) {
    points.push({
      text: `本周复习还剩 ${week.reviewPlanned - week.reviewDone} 块没完成`,
      factIds: ['week-review'],
    });
  }

  // headline
  const headline = today.courses.length
    ? earlyClass
      ? `今天 ${today.courses.length} 节课，${hhmm(firstToday.startMin)} 开课`
      : `今天 ${today.courses.length} 节课`
    : tomorrow.courses.length
      ? `今天没课，明天有 ${tomorrow.courses.length} 节`
      : '今天没课，明天也空着';

  // advice
  let advice = '按课表走就行，不用额外安排。';
  if (earlyClass && shortSleep) advice = '上午别硬塞难题，午后补 20 分钟。';
  else if (nextExam && nextExam.days <= 3) advice = `今晚的空档让给${nextExam.title}。`;
  else if (gap) advice = '空档先占上，别等到晚上再决定。';
  else if (week.reviewPlanned > week.reviewDone) advice = '复习别堆到周末，今天补一块。';

  return {
    headline,
    points: points.slice(0, MAX_POINTS),
    advice,
    generatedBy: 'template',
    generatedAt: now.toISOString(),
  };
}

export interface BriefGenerator {
  id: string;
  generate(bundle: FactBundle, now: Date): Promise<Brief>;
}

export const templateGenerator: BriefGenerator = {
  id: 'template',
  async generate(bundle, now) {
    return composeBrief(bundle, now);
  },
};

/**
 * 生成 + 校验 + 兜底。
 * 生成器返回的内容只要有一条不合法，就整体回落到模板，不做局部修补。
 */
export async function generateBrief(
  bundle: FactBundle,
  now: Date,
  generator: BriefGenerator = templateGenerator,
): Promise<Brief> {
  try {
    const brief = await generator.generate(bundle, now);
    const check = validateBrief(brief, bundle);
    if (check.ok) return brief;
    if (import.meta.env.DEV) {
      console.warn('[brief] 校验未通过，回落模板：', check.errors);
    }
    return composeBrief(bundle, now);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[brief] 生成失败，回落模板：', err);
    return composeBrief(bundle, now);
  }
}
