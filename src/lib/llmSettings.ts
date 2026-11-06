/**
 * 模型接入的配置（存在本机 localStorage，不上传）
 *
 * 刻意只支持「OpenAI 兼容」的 chat/completions：DeepSeek、通义、Kimi、OpenAI
 * 都是这一个形状，用户填自己的 Key，小山不代管额度、不做中转。
 * 没有配 Key 时全部功能回落到本地模板，界面不能因为没网就不能用。
 */

export interface LlmSettings {
  /** 关掉后即使配了 Key 也不发请求（断网或想省额度时按一下） */
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const STORAGE_KEY = 'xiaoshan:llm';

export interface LlmPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '国内直连，便宜；Key 在 platform.deepseek.com 申请',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需要能访问 openai.com 的网络',
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '阿里云百炼，OpenAI 兼容模式',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '月之暗面开放平台',
  },
];

export const DEFAULT_SETTINGS: LlmSettings = {
  enabled: false,
  baseUrl: LLM_PRESETS[0].baseUrl,
  model: LLM_PRESETS[0].model,
  apiKey: '',
};

export function loadLlmSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      enabled: parsed.enabled === true,
      baseUrl: (parsed.baseUrl || DEFAULT_SETTINGS.baseUrl).trim(),
      model: (parsed.model || DEFAULT_SETTINGS.model).trim(),
      apiKey: (parsed.apiKey || '').trim(),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveLlmSettings(next: LlmSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  // 让正在看报告的页面知道「模型开关变了」，重新生成简报
  window.dispatchEvent(new Event('xiaoshan:llm-changed'));
}

/** 填好了、并且开关是开的，才算能用 */
export function isLlmReady(s: LlmSettings = loadLlmSettings()): boolean {
  return s.enabled && s.apiKey.length > 0 && /^https?:\/\//.test(s.baseUrl) && s.model.length > 0;
}

/** Key 打码，给界面显示用 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
