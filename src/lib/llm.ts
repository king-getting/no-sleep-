import { validateBrief, type Brief, type BriefGenerator } from '@/lib/brief';
import type { FactBundle } from '@/lib/facts';

/**
 * 模型润色层（可选，默认关闭）
 *
 * 只做一件事：把「事实包」交给一个 OpenAI 兼容的 chat 接口，让它写出
 * headline / points / advice，并且每句话都必须挂 factIds。
 * 返回后仍是那套 validateBrief 校验：引用不存在、超长、空文本，一律判失败，
 * 由 generateBrief 整体回落到模板。
 *
 * 隐私：开启后发送的只有 bundle.facts 的 id 与一句话描述（课程名、地点、
 * 睡眠时长、考试名、周统计），不含姓名、学号、账号；key 只存在本机。
 */

export interface LlmConfig {
  enabled: boolean;
  /** OpenAI 兼容的 base，例如 https://api.openai.com/v1 或自建网关 */
  baseUrl: string;
  model: string;
  apiKey: string;
}

const KEY = 'xiaoshan:llm';

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
};

export function readLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_LLM_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return { ...DEFAULT_LLM_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

export function writeLlmConfig(cfg: LlmConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function llmReady(cfg: LlmConfig): boolean {
  return cfg.enabled && Boolean(cfg.apiKey.trim()) && Boolean(cfg.baseUrl.trim()) && Boolean(cfg.model.trim());
}

const SYSTEM_PROMPT = [
  '你是校园助手「小山」的文案层，只负责把给定事实写成简短中文。',
  '硬性规则：',
  '1. 只能使用 facts 里出现的信息，不得新增课程、时间、数字或因果。',
  '2. 每个 point 必须挂 factIds，且只能引用 facts 里存在的 id。',
  '3. headline ≤ 30 字，每个 point.text ≤ 45 字，advice ≤ 40 字。',
  '4. points 最多 3 条，按「今天最该先知道」排序。',
  '5. 语气平实，不说教，不用感叹号，不承诺结果。',
  '输出严格 JSON：{"headline": string, "points": [{"text": string, "factIds": string[]}], "advice": string}',
].join('\n');

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** 把事实包压成模型输入：id + 一句话，足够写文案，又不多给 */
function factsForModel(bundle: FactBundle): { id: string; kind: string; text: string }[] {
  return bundle.facts.slice(0, 40).map((f) => ({ id: f.id, kind: f.kind, text: f.label }));
}

async function callModel(
  bundle: FactBundle,
  cfg: LlmConfig,
  signal: AbortSignal,
): Promise<Brief> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: cfg.model,
    temperature: 0.2,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          now: bundle.generatedAt,
          facts: factsForModel(bundle),
          today: {
            courses: bundle.summary.today.courses.map((c) => c.name),
            freeBlocks: bundle.summary.today.freeBlocks.length,
          },
        }),
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`模型接口 ${res.status}：${text.slice(0, 120)}`);
  }

  const json = (await res.json()) as ChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error(json.error?.message ?? '模型没有返回内容');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('模型返回的不是 JSON');
  }

  const obj = parsed as { headline?: unknown; points?: unknown; advice?: unknown };
  const points = Array.isArray(obj.points) ? obj.points : [];
  return {
    headline: String(obj.headline ?? '').trim(),
    points: points.map((p) => {
      const item = p as { text?: unknown; factIds?: unknown };
      return {
        text: String(item.text ?? '').trim(),
        factIds: Array.isArray(item.factIds) ? item.factIds.map(String) : [],
      };
    }),
    advice: String(obj.advice ?? '').trim(),
    generatedBy: 'model',
    generatedAt: new Date().toISOString(),
  };
}

export function createLlmGenerator(cfg: LlmConfig, timeoutMs = 12_000): BriefGenerator {
  return {
    id: 'llm',
    async generate(bundle) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const brief = await callModel(bundle, cfg, ctrl.signal);
        // 这里再校验一次：不合格直接抛，交给 generateBrief 的兜底链路
        const check = validateBrief(brief, bundle);
        if (!check.ok) throw new Error(`校验未通过：${check.errors.join('；')}`);
        return brief;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** 设置页的「测试连接」：只发一句话，确认地址 / key / 模型名都对 */
export async function testLlm(cfg: LlmConfig, timeoutMs = 10_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: '只回复 ok' }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}：${text.slice(0, 100)}`);
    }
    return '连接正常';
  } finally {
    clearTimeout(timer);
  }
}
