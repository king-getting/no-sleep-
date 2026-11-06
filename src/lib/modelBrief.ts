/**
 * 用模型写今日简报
 *
 * 和模板生成器实现同一个 `BriefGenerator` 接口，所以校验、兜底、回落
 * 全都不用改：模型只要有一句引用不到事实、或者超长，`generateBrief`
 * 会整体退回模板，界面不会出现「看起来像模型编的」文本。
 */

import { composeBrief, type Brief, type BriefGenerator } from '@/lib/brief';
import type { FactBundle } from '@/lib/facts';
import { chatComplete, parseJsonLoose } from '@/lib/llm';
import { isLlmReady, loadLlmSettings } from '@/lib/llmSettings';

const MAX_HEADLINE = 40;
const MAX_POINT = 60;
const MAX_ADVICE = 60;

function clip(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface RawBrief {
  headline?: string;
  points?: { text?: string; angle?: unknown; factIds?: unknown }[];
  advice?: string;
}

/** 把事实包压成「id｜人话」两列，只给模型这些，别的它看不到 */
function factLines(bundle: FactBundle): string {
  return bundle.facts
    .slice(0, 48)
    .map((f) => `${f.id}｜${f.label}`)
    .join('\n');
}

export function modelGenerator(): BriefGenerator {
  return {
    id: 'model',
    async generate(bundle: FactBundle, now: Date): Promise<Brief> {
      const settings = loadLlmSettings();
      if (!isLlmReady(settings)) return composeBrief(bundle, now);

      const { summary } = bundle;
      const today = summary.today.courses.map((c) => c.name).join('、') || '无课';
      const prompt = `根据下面的事实写今天的校园简报。事实之外的东西一个字都不要写。

事实清单（每行是「id｜描述」）：
${factLines(bundle)}

补充：
今天课程：${today}
最近考试：${summary.nextExam ? `${summary.nextExam.title}（${summary.nextExam.days} 天后）` : '无'}
昨晚睡眠：${summary.lastNight ? `${summary.lastNight.hours} 小时` : '无记录'}

只输出 JSON，不要 markdown：
{"headline":"不超过20字的总判断","points":[{"angle":"academic|life|health|schedule","text":"不超过30字的一条结论","factIds":["只能填上面清单里出现过的 id"]}],"advice":"不超过30字的一条建议"}

要求：
- 必须从四个方向里至少选 **3 个不同角度**分析：academic（课程与考试）、life（吃住行与时间成本）、health（睡眠与精力）、schedule（时间块与冲突）。每个 point 的 angle 只能填这四个值之一。
- points 2–4 条，覆盖的角度不能重复；每条挂 1–2 个真实存在的 factId。
- 不同角度的结论要真的不一样：不要四条都在说「今天有课」。
- advice 必须是明天就能做的一个具体动作，不要「注意休息」这类空话。
- 用中文口语，不要出现「根据数据显示」这类套话。
- 不要编造清单里没有的课程、考试、时间。`;

      const res = await chatComplete(
        [
          { role: 'system', content: '你是校园助手「小山」，只依据给定事实写简报，输出严格 JSON。' },
          { role: 'user', content: prompt },
        ],
        { settings, temperature: 0.3, maxTokens: 600 },
      );

      const json = parseJsonLoose<RawBrief>(res.content);
      if (!json) throw new Error('模型没有返回可用 JSON');

      const ANGLES = ['academic', 'life', 'health', 'schedule'] as const;
      const points = (json.points ?? [])
        .map((p) => ({
          text: clip(p.text, MAX_POINT),
          angle: ANGLES.includes(p.angle as (typeof ANGLES)[number])
            ? (p.angle as (typeof ANGLES)[number])
            : undefined,
          factIds: Array.isArray(p.factIds) ? p.factIds.filter((x): x is string => typeof x === 'string') : [],
        }))
        .filter((p) => p.text.length > 0 && p.factIds.length > 0)
        .slice(0, 4);

      // 多角度是模型写简报的硬要求：少于 2 个不同角度就算不合格，整段回落模板
      const angles = new Set(points.map((p) => p.angle).filter(Boolean));
      if (angles.size < 2) throw new Error(`模型只给了 ${angles.size} 个角度，达不到多角度分析的要求`);

      return {
        headline: clip(json.headline, MAX_HEADLINE) || clip(summary.today.courses[0]?.name, MAX_HEADLINE) || '今天',
        points,
        advice: clip(json.advice, MAX_ADVICE),
        generatedBy: 'model',
        generatedAt: now.toISOString(),
      };
    },
  };
}

export { MAX_HEADLINE, MAX_POINT, MAX_ADVICE };
