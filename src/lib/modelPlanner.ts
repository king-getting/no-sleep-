import { chatComplete, parseJsonLoose } from '@/lib/llm';
import { isLlmReady, loadLlmSettings } from '@/lib/llmSettings';
import type { OptionCard } from '@/types/contract';

/**
 * 让模型「做决定」，而不是只写文案
 *
 * 规则引擎负责算数与边界（几点起、能睡多久、预算多少、有哪些空档），
 * 模型只在这个边界里挑方案、说人话。所以：
 *   1. 输入是本地事实 + 画像 + 历史，不是空白提示
 *   2. 输出必须过 `validateSleepPlan`：超时、超长、越界、少一组「现在就睡」都判失败
 *   3. 任何一步失败都返回 null，调用方继续用规则引擎的选项（规则是下限）
 */

export interface SleepPlanInput {
  now: Date;
  /** 明早闹钟（分钟） */
  wakeMin: number;
  /** 现在睡能睡几小时 */
  sleepNowHours: number;
  /** 硬边界：最晚可以拖到多少分钟（由规则算，模型不能越过） */
  maxDelayMin: number;
  lastNightHours?: number | null;
  avg3Hours?: number | null;
  debt7Hours?: number | null;
  /** 画像摘要，例如「大二 · 计算机学院 · 桂子山」 */
  profileLine?: string;
  /** 最近的选择历史，例如「昨天：晚睡半小时」 */
  history?: string[];
}

interface RawSleepOption {
  delayMin?: unknown;
  title?: unknown;
  pros?: unknown;
  cons?: unknown;
  fallback?: unknown;
  impacts?: unknown;
}

const MAX_TITLE = 28;
const MAX_LINE = 24;
const MAX_IMPACT = 30;

const clip = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const strList = (v: unknown, max: number, maxLen: number): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => clip(x, maxLen))
    .filter(Boolean)
    .slice(0, max);

function minutesToClock(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = ((min % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 纯函数校验：给定模型输出与本地边界，产出可上屏的选项，或 null。
 * 单独导出是为了能脱离网络直接测。
 */
export function validateSleepPlan(raw: unknown, input: SleepPlanInput): OptionCard[] | null {
  const list = Array.isArray(raw) ? (raw as RawSleepOption[]) : null;
  if (!list || list.length < 2 || list.length > 3) return null;

  const options: OptionCard[] = [];
  const seen = new Set<number>();

  for (const item of list) {
    const delay = Number(item.delayMin);
    if (!Number.isFinite(delay)) return null;
    if (delay < 0 || delay > input.maxDelayMin) return null;
    if (seen.has(delay)) return null;
    seen.add(delay);

    const title = clip(item.title, MAX_TITLE);
    if (title.length < 4) return null;

    const pros = strList(item.pros, 2, MAX_LINE);
    const cons = strList(item.cons, 2, MAX_LINE);
    if (cons.length === 0) return null;

    const impacts = (Array.isArray(item.impacts) ? item.impacts : [])
      .map((x) => {
        const o = x as { horizon?: unknown; text?: unknown };
        const horizon = o.horizon === 'long' ? 'long' : 'short';
        const text = clip(o.text, MAX_IMPACT);
        return text ? { horizon: horizon as 'short' | 'long', text } : null;
      })
      .filter((x): x is { horizon: 'short' | 'long'; text: string } => Boolean(x))
      .slice(0, 2);

    const sleepHours = input.sleepNowHours - delay / 60;
    if (sleepHours < 3) return null; // 少于 3 小时不是「建议」，是熬夜方案

    const nowMin = input.now.getHours() * 60 + input.now.getMinutes();
    const when = delay === 0 ? '现在' : `现在 → ${minutesToClock(nowMin + delay)}`;

    options.push({
      id: `sleep-model-${delay}`,
      title,
      when,
      cost: { timeMin: delay, effort: 1 },
      pros,
      cons,
      fallback: clip(item.fallback, MAX_LINE) || undefined,
      impacts: impacts.map((x) => ({ ...x, directionId: 'health' as const })),
      evidences: [
        {
          directionId: 'health',
          text:
            input.avg3Hours != null
              ? `近三晚平均 ${input.avg3Hours.toFixed(1)} 小时`
              : `按明早 ${minutesToClock(input.wakeMin)} 的作息反推`,
          confidence: 3,
        },
      ],
    });
  }

  // 必须给「现在就睡」这一档，否则用户没有最早的选项
  if (!options.some((o) => (o.cost.timeMin ?? 0) === 0)) return null;
  // 至少要有一档「往后挪」的，否则模型等于没做取舍
  if (!options.some((o) => (o.cost.timeMin ?? 0) > 0)) return null;

  return options.sort((a, b) => (a.cost.timeMin ?? 0) - (b.cost.timeMin ?? 0));
}

/** 调用模型生成今晚的睡眠方案；没配 Key / 校验不过 / 网络失败都返回 null */
export async function planSleep(input: SleepPlanInput): Promise<OptionCard[] | null> {
  const settings = loadLlmSettings();
  if (!isLlmReady(settings)) return null;

  const facts = [
    `现在时刻：${minutesToClock(input.now.getHours() * 60 + input.now.getMinutes())}`,
    `明早闹钟：${minutesToClock(input.wakeMin)}`,
    `现在睡能睡：${input.sleepNowHours.toFixed(1)} 小时`,
    `最晚可以拖：${input.maxDelayMin} 分钟（越界不接受）`,
    input.lastNightHours != null ? `昨晚实际睡了：${input.lastNightHours.toFixed(1)} 小时` : '昨晚没有记录',
    input.avg3Hours != null ? `近三晚平均：${input.avg3Hours.toFixed(1)} 小时` : '近三晚记录不足',
    input.debt7Hours != null ? `近七晚累计睡眠债：${input.debt7Hours.toFixed(1)} 小时` : '',
    input.profileLine ? `使用者画像：${input.profileLine}` : '',
    input.history?.length ? `最近的选择：${input.history.slice(0, 5).join('；')}` : '没有可参考的选择历史',
  ].filter(Boolean);

  const prompt = `你在帮一位大学生决定今晚几点睡。只依据下面这些本地数据，不许编造新的时间或数字。

数据：
${facts.join('\n')}

只输出 JSON 数组，不要 markdown：
[{"delayMin":0,"title":"现在就睡（能睡 8.5 小时）","pros":["…"],"cons":["…"],"fallback":"…","impacts":[{"horizon":"short","text":"…"}]}]

硬性要求：
- 2–3 个方案，delayMin 必须是 0 / 30 / 60 这类 5 的倍数，且不超过允许的最晚分钟数。
- 必须包含 delayMin=0 的「现在就睡」，以及至少一个往后挪的选项（例如晚睡 30 分钟）。
- 标题 ≤28 字，写清「几点睡、还剩几小时」；pros ≤2 条、cons ≤2 条，每条 ≤24 字。
- cons 必须写真实的代价（少睡多少），不要写「不健康」这类说教。
- 不许出现「刷手机」这种把坏习惯当唯一替代方案的说法；往后挪的时间用途交给用户自己。
- impacts 的 text 必须可观察（明早哪节课会受影响），不许写「概率更高」。`;

  try {
    const res = await chatComplete(
      [
        { role: 'system', content: '你是校园助手「小山」，只在给定边界内安排作息，输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      { settings, temperature: 0.2, maxTokens: 600 },
    );
    const parsed = parseJsonLoose<unknown>(res.content);
    return validateSleepPlan(parsed, input);
  } catch {
    return null;
  }
}
