/**
 * 极薄的 OpenAI 兼容客户端
 *
 * 只做三件事：拼请求、解析 tool_calls、把各种失败翻译成人话。
 * 不引第三方 SDK —— 这点请求量不值得多一个依赖，而且浏览器里直连最容易排查。
 */

import { isLlmReady, loadLlmSettings, type LlmSettings } from '@/lib/llmSettings';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type LlmErrorKind = 'no-key' | 'auth' | 'quota' | 'network' | 'timeout' | 'server' | 'bad-response';

export class LlmError extends Error {
  kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'LlmError';
  }
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

const TIMEOUT_MS = 45_000;

function friendly(kind: LlmErrorKind, detail: string): string {
  switch (kind) {
    case 'no-key':
      return '还没配置模型。去「设置 → 模型接入」填一个 API Key。';
    case 'auth':
      return 'Key 不对或已失效（401）。请到设置里重新填。';
    case 'quota':
      return '额度不够或请求太频繁（402/429）。';
    case 'network':
      return '连不上模型服务。检查网络，或换一个 base URL。';
    case 'timeout':
      return '模型 45 秒没有回应，先按取消重试。';
    case 'server':
      return `模型服务出错了（${detail}）。过一会儿再试。`;
    default:
      return '模型返回的格式看不懂，换一次再试。';
  }
}

/** 一次 chat/completions 调用 */
export async function chatComplete(
  messages: ChatMessage[],
  options: {
    settings?: LlmSettings;
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ChatResult> {
  const settings = options.settings ?? loadLlmSettings();
  if (!isLlmReady(settings)) throw new LlmError('no-key', friendly('no-key', ''));

  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 800,
        ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    const aborted = (err as Error)?.name === 'AbortError';
    throw new LlmError(aborted ? 'timeout' : 'network', friendly(aborted ? 'timeout' : 'network', ''));
  }
  clearTimeout(timer);
  options.signal?.removeEventListener('abort', onAbort);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', friendly('auth', ''));
    if (res.status === 402 || res.status === 429) throw new LlmError('quota', friendly('quota', ''));
    throw new LlmError('server', friendly('server', `${res.status} ${detail.slice(0, 80)}`));
  }

  let json: { choices?: { message?: unknown }[] } | null;
  try {
    json = (await res.json()) as { choices?: { message?: unknown }[] };
  } catch {
    throw new LlmError('bad-response', friendly('bad-response', ''));
  }

  const message = json?.choices?.[0]?.message as ChatMessage | undefined;
  if (!message) throw new LlmError('bad-response', friendly('bad-response', ''));

  return {
    content: typeof message.content === 'string' ? message.content : null,
    toolCalls: Array.isArray(message.tool_calls) ? (message.tool_calls as ToolCall[]) : [],
  };
}

/** 要纯 JSON 的场合（简报 / 预报），把模型可能带的 ```json 包装剥掉 */
export function parseJsonLoose<T>(text: string | null): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
