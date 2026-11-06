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
  points?: { text?: string; factIds?: unknown }[];
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
{"headline":"不超过20字的总判断","points":[{"text":"不超过30字的一条结论","factIds":["只能填上面清单里出现过的 id"]}],"advice":"不超过30字的一条建议"}

要求：
- points 1–3 条，每条必须挂 1–2 个真实存在的 factId。
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

      const points = (json.points ?? [])
        .map((p) => ({
          text: clip(p.text, MAX_POINT),
          factIds: Array.isArray(p.factIds) ? p.factIds.filter((x): x is string => typeof x === 'string') : [],
        }))
        .filter((p) => p.text.length > 0 && p.factIds.length > 0)
        .slice(0, 4);

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
