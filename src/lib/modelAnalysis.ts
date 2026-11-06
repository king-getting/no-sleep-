import type { DirectionId } from '@/types/contract';
import { chatComplete, parseJsonLoose } from '@/lib/llm';
import { isLlmReady, loadLlmSettings } from '@/lib/llmSettings';
import { specialDayOf } from '@/lib/special';

/**
 * 报告里的「分析」区块
 *
 * 规则引擎先把发现摆出来（睡眠债、明天的早八、DDL、空档），
 * 模型负责把它们串成「所以我建议你……」——多角度、有取舍、最后落一个动作。
 * 校验不过就退回规则版的几句陈述，报告不会因此缺一块。
 */

export type AnalysisLine = { text: string; directionId?: DirectionId };
export interface AnalysisBlock {
  lines: AnalysisLine[];
  advice: string;
  by: 'model' | 'rules';
}

export interface AnalysisInput {
  now: Date;
  findings: { id: string; summary: string; type: string }[];
  suggestions: { topic: string; priority: number }[];
  profileLine?: string;
  history?: string[];
}

const MAX_LINE = 42;
const MAX_ADVICE = 42;
const ANGLES = ['academic', 'life', 'health', 'schedule'] as const;

const clip = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** 规则版：只陈述事实，不做推断 */
export function ruleAnalysis(input: AnalysisInput): AnalysisBlock {
  const pick = (frag: string) => input.findings.find((f) => f.id.includes(frag));
  const lines: AnalysisLine[] = [];

  // 节日 / 纪念日先给一句人话，再谈今天怎么过
  const special = specialDayOf(input.now);
  if (special) lines.push({ text: special.greeting });

  const sleep = pick('sleep');
  if (sleep) lines.push({ text: sleep.summary, directionId: 'health' });

  const courses = pick('today-courses');
  if (courses) lines.push({ text: courses.summary, directionId: 'academic' });

  const exam = pick('exam:countdown');
  if (exam) lines.push({ text: exam.summary, directionId: 'academic' });

  const blocks = pick('timeblocks');
  if (blocks) lines.push({ text: blocks.summary, directionId: 'schedule' });

  const top = [...input.suggestions].sort((a, b) => a.priority - b.priority)[0];
  return {
    lines: lines.slice(0, 4),
    advice: top ? `今天最该先处理的是「${top.topic}」，别的先放一放。` : '先按课表走，有空就出去走走。',
    by: 'rules',
  };
}

/** 纯函数校验：模型输出必须多角度、有具体动作 */
export function validateAnalysis(raw: unknown): AnalysisBlock | null {
  const obj = raw as { lines?: unknown; advice?: unknown } | null;
  const list = Array.isArray(obj?.lines) ? obj.lines : null;
  if (!list || list.length < 2 || list.length > 4) return null;

  const lines: AnalysisLine[] = [];
  for (const item of list) {
    const o = item as { text?: unknown; angle?: unknown };
    const text = clip(o.text, MAX_LINE);
    if (text.length < 6) return null;
    const angle = ANGLES.includes(o.angle as (typeof ANGLES)[number])
      ? (o.angle as DirectionId)
      : undefined;
    lines.push({ text, directionId: angle });
  }

  const angles = new Set(lines.map((l) => l.directionId).filter(Boolean));
  if (angles.size < 2) return null;

  const advice = clip(obj?.advice, MAX_ADVICE);
  if (advice.length < 6) return null;

  return { lines, advice, by: 'model' };
}

/** 配了模型就让模型写；没配 / 失败 / 校验不过都退回规则版 */
export async function composeAnalysis(input: AnalysisInput): Promise<AnalysisBlock> {
  const fallback = ruleAnalysis(input);
  const settings = loadLlmSettings();
  if (!isLlmReady(settings)) return fallback;

  const facts = input.findings
    .slice(0, 20)
    .map((f) => `- ${f.id}｜${f.summary}`)
    .join('\n');
  const topics = input.suggestions.slice(0, 6).map((s) => s.topic).join('、');
  const special = specialDayOf(input.now);

  const prompt = `你在给一位大学生写今天的报告分析。只依据下面的事实，不要编造。
事实：
${facts}
今天会给出的建议主题：${topics || '无'}
${special ? `今天是：${special.label}，可以用一句自然的问候开场，不要说教` : ''}
${input.profileLine ? `画像：${input.profileLine}` : ''}
${input.history?.length ? `最近的选择：${input.history.slice(0, 5).join('；')}` : ''}

输出严格 JSON：
{"lines":[{"angle":"academic|life|health|schedule","text":"一句分析，≤42 字"}],"advice":"一句具体动作，≤42 字"}

要求：
- lines 2–4 条，至少覆盖 2 个不同角度，同一角度不重复。
- 每条要说明「这个事实意味着什么」，不是复述数字。
- advice 必须是今天就能做的一步，不要「注意身体」这类空话。
- 不写概率、不写诊断、不承诺结果。`;

  try {
    const res = await chatComplete(
      [
        { role: 'system', content: '你是校园助手「小山」，基于事实做分析，输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      { settings, temperature: 0.3, maxTokens: 700 },
    );
    const parsed = parseJsonLoose<unknown>(res.content);
    return validateAnalysis(parsed) ?? fallback;
  } catch {
    return fallback;
  }
}
