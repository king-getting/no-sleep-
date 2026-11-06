import { useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Plug, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeLlmError } from '@/agent/chat';
import { chatComplete } from '@/lib/llm';
import {
  DEFAULT_SETTINGS,
  LLM_PRESETS,
  loadLlmSettings,
  maskKey,
  saveLlmSettings,
  type LlmSettings,
} from '@/lib/llmSettings';
import { cn } from '@/lib/utils';

/**
 * 模型接入
 *
 * 用户自带 Key，只存在本机 localStorage（`xiaoshan:llm`），清库时一起清掉。
 * 没配也能用小山——简报/预报/总结全都回落到本地模板，只是不能对话。
 */
export default function ModelSettings() {
  const [draft, setDraft] = useState<LlmSettings>(() => loadLlmSettings());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(false);

  function patch(next: Partial<LlmSettings>) {
    setDraft((prev) => ({ ...prev, ...next }));
    setSaved(false);
    setTestResult(null);
  }

  function applyPreset(id: string) {
    const preset = LLM_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    patch({ baseUrl: preset.baseUrl, model: preset.model });
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await chatComplete([{ role: 'user', content: '回一个字：好' }], {
        settings: { ...draft, enabled: true },
        maxTokens: 16,
        temperature: 0,
      });
      setTestResult({ ok: true, text: `连上了，模型回了：${(reply.content ?? '').trim().slice(0, 20) || '（空）'}` });
    } catch (err) {
      setTestResult({ ok: false, text: describeLlmError(err) });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    const next: LlmSettings = {
      enabled: draft.enabled,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
    };
    saveLlmSettings(next);
    setDraft(next);
    setSaved(true);
  }

  const activePreset = LLM_PRESETS.find((p) => p.baseUrl === draft.baseUrl)?.id ?? '';

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">模型接入</h2>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="启用模型"
          onClick={() => patch({ enabled: !draft.enabled })}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition',
            draft.enabled ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all',
              draft.enabled ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        填自己的 Key，用来生成今日简报、预报和总结，让模型在本地算好的边界里排「今晚几点睡」这类建议，
        也能在右下角直接对话改数据。发送的只有事实清单与画像摘要，Key 只存在这台设备的 localStorage。
        不填也能用：所有内容回落到本地规则。
      </p>

      <div className="flex flex-wrap gap-1.5">
        {LLM_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] transition',
              activePreset === p.id
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:border-primary/30 hover:text-foreground',
            )}
            title={p.hint}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">API Key</span>
          <div className="mt-0.5 flex items-center gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full rounded-lg border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label={showKey ? '隐藏 Key' : '显示 Key'}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {!showKey && draft.apiKey && (
            <span className="mt-0.5 block text-[10px] text-muted-foreground">当前：{maskKey(draft.apiKey)}</span>
          )}
        </label>

        <label className="block">
          <span className="text-[11px] text-muted-foreground">Base URL（OpenAI 兼容）</span>
          <input
            value={draft.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            spellCheck={false}
            className="mt-0.5 h-9 w-full rounded-lg border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-muted-foreground">模型名</span>
          <input
            value={draft.model}
            onChange={(e) => patch({ model: e.target.value })}
            spellCheck={false}
            className="mt-0.5 h-9 w-full rounded-lg border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save}>
          {saved ? <Check className="mr-1 h-3.5 w-3.5" /> : null}
          {saved ? '已保存' : '保存'}
        </Button>
        <Button variant="outline" size="sm" disabled={testing || !draft.apiKey} onClick={() => void test()}>
          {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1 h-3.5 w-3.5" />}
          {testing ? '测试中…' : '测试连接'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft({ ...DEFAULT_SETTINGS, apiKey: '' });
            saveLlmSettings({ ...DEFAULT_SETTINGS, apiKey: '' });
            setSaved(false);
            setTestResult(null);
          }}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重置
        </Button>
      </div>

      {testResult && (
        <p
          className={cn(
            'mt-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed',
            testResult.ok ? 'bg-primary/5 text-foreground' : 'bg-destructive/10 text-destructive',
          )}
        >
          {testResult.text}
        </p>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Key 会随「清除全部本机数据」一起删掉，换电脑也不会带走。请求由浏览器直连模型服务商，小山不保存对话记录。
      </p>
    </section>
  );
}
