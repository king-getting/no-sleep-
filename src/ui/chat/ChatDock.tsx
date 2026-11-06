import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowUp, Loader2, MessageCircle, Settings2, Sparkles, X } from 'lucide-react';
import { askXiaoshan, describeLlmError, type ChatTurn } from '@/agent/chat';
import { isLlmReady, loadLlmSettings } from '@/lib/llmSettings';
import { cn } from '@/lib/utils';

/**
 * 和小山对话的侧边抽屉
 *
 * 右侧悬浮入口，点开是一个对话面板：问今天有什么课、让它加一门课、
 * 改餐标、记睡眠——它调工具改本机数据，改完首页会自己重算。
 * 没配模型时不禁用入口，而是给出「去哪配」的明确出口。
 */

const QUICK = [
  '今天有什么课？',
  '这周还有哪些 DDL？',
  '帮我在周三下午三点加一门课',
  '我昨晚只睡了 5 个半小时',
];

export default function ChatDock() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(() => isLlmReady());
  const scroller = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 设置页改完 Key 回来，这里要立刻知道
  useEffect(() => {
    const sync = () => setReady(isLlmReady(loadLlmSettings()));
    sync();
    window.addEventListener('xiaoshan:llm-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('xiaoshan:llm-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, turns, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', text: question }];
    setTurns(nextTurns);
    setBusy(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await askXiaoshan(nextTurns, question, { signal: controller.signal });
      setTurns((prev) => [...prev, { role: 'assistant', text: reply.text, actions: reply.actions }]);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', text: '这次没连上模型。', error: describeLlmError(err) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed right-4 bottom-20 z-30 flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-medium shadow-lg transition lg:right-6 lg:bottom-6',
          open ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground hover:opacity-95',
        )}
        aria-expanded={open}
      >
        <MessageCircle className="h-4 w-4" />
        问小山
      </button>

      {open && (
        <section
          className="fixed right-3 bottom-32 z-30 flex w-[min(94vw,392px)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl lg:right-6 lg:bottom-20"
          style={{ height: 'min(72vh, 560px)' }}
          aria-label="和小山对话"
        >
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-none">小山</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {ready ? '已接入模型 · 数据仍在本机' : '还没配模型 · 只能看模板报告'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/settings');
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="去设置里配置模型"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="收起"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  我是小山。课表、DDL、睡眠、餐标我都能改，也能告诉你今天该怎么排。数据只在这台设备上。
                </p>
                {!ready && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate('/settings');
                    }}
                    className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-900"
                  >
                    还没填 API Key，对话用不了。点这里去「设置 → 模型接入」，填完回来就能用。
                  </button>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[86%] space-y-1', t.role === 'user' && 'text-right')}>
                  <div
                    className={cn(
                      'inline-block rounded-2xl px-3 py-2 text-left text-[13px] leading-relaxed whitespace-pre-wrap',
                      t.role === 'user'
                        ? 'rounded-br-md bg-primary text-primary-foreground'
                        : 'rounded-bl-md bg-secondary text-secondary-foreground',
                    )}
                  >
                    {t.text}
                  </div>
                  {t.error && (
                    <p className="rounded-lg bg-destructive/10 px-2 py-1.5 text-left text-[11px] text-destructive">
                      {t.error}
                      {t.error.includes('Key') && (
                        <button
                          type="button"
                          className="ml-1 underline underline-offset-2"
                          onClick={() => {
                            setOpen(false);
                            navigate('/settings');
                          }}
                        >
                          去设置
                        </button>
                      )}
                    </p>
                  )}
                  {t.actions && t.actions.length > 0 && (
                    <ul className="space-y-1">
                      {t.actions.map((a, j) => (
                        <li
                          key={j}
                          className={cn(
                            'rounded-lg border px-2 py-1 text-left text-[11px]',
                            a.ok ? 'border-primary/25 bg-primary/5 text-foreground' : 'border-amber-300 bg-amber-50 text-amber-900',
                          )}
                        >
                          <span className="font-medium">{a.ok ? '小山做了' : '没做成'}：</span>
                          {a.summary}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                小山在看你的课表…
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-1.5 border-t px-2.5 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={ready ? '跟小山说点什么…' : '先去设置里填 API Key'}
              className="max-h-24 min-h-[36px] flex-1 resize-none rounded-xl border bg-background px-2.5 py-2 text-[13px] outline-none focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="发送"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
