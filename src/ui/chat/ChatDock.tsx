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
  '我昨晚只睡了 5 个半小时', '今天有点累，怎么安排？',
];

const POS_KEY = 'xiaoshan:chat-pos';
const LONG_PRESS_MS = 380;
const DRAG_THRESHOLD = 8;

type Pos = { x: number; y: number };

/** 抽屉跟着按钮走：优先放在按钮上方，放不下就放下面，左右夹进可视区 */
function drawerBox(pos: Pos, viewport: { w: number; h: number }): React.CSSProperties {
  const width = Math.min(viewport.w * 0.94, 392);
  const height = Math.min(viewport.h * 0.72, 560);
  const gap = 12;
  const left = Math.min(Math.max(8, pos.x + 48 - width), Math.max(8, viewport.w - width - 8));
  const above = pos.y > height + gap + 8;
  const top = above
    ? Math.max(8, pos.y - height - gap)
    : Math.min(Math.max(8, pos.y + 56), Math.max(8, viewport.h - height - 8));
  return { left, top, width, height };
}

function clampPos(p: Pos, size: { w: number; h: number }): Pos {
  const maxX = Math.max(8, window.innerWidth - size.w - 8);
  const maxY = Math.max(8, window.innerHeight - size.h - 8);
  return { x: Math.min(Math.max(8, p.x), maxX), y: Math.min(Math.max(8, p.y), maxY) };
}

function readPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pos>;
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

export default function ChatDock() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(() => isLlmReady());
  const scroller = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  /** 拖动后的位置；null = 用默认的右下角 */
  const [pos, setPos] = useState<Pos | null>(() => readPos());
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 0 : window.innerWidth,
    h: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  const drag = useRef<{
    longPress: boolean;
    timer: number | null;
    offsetX: number;
    offsetY: number;
    startedX: number;
    startedY: number;
    moved: boolean;
  } | null>(null);
  const skipClick = useRef(false);

  // 窗口变了，把按钮拉回可视区（用户可能缩窗口、转屏）
  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setPos((prev) => {
        if (!prev) return prev;
        const el = btnRef.current;
        const size = { w: el?.offsetWidth ?? 96, h: el?.offsetHeight ?? 40 };
        return clampPos(prev, size);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function clearLongPress() {
    const d = drag.current;
    if (d?.timer) {
      window.clearTimeout(d.timer);
      d.timer = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // 抓指针：不抓的话指针一离开按钮，pointermove 就发给别的元素了，拖不动
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 某些浏览器/合成事件不支持，退化成普通点击
    }
    drag.current = {
      longPress: false,
      timer: window.setTimeout(() => {
        if (!drag.current) return;
        drag.current.longPress = true;
        setDragging(true);
      }, LONG_PRESS_MS),
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startedX: e.clientX,
      startedY: e.clientY,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.longPress) {
      // 还没长按就滑开——当成滚动/误触，取消长按
      if (Math.hypot(e.clientX - d.startedX, e.clientY - d.startedY) > DRAG_THRESHOLD) {
        clearLongPress();
      }
      return;
    }
    e.preventDefault();
    d.moved = true;
    const el = btnRef.current;
    const size = { w: el?.offsetWidth ?? 96, h: el?.offsetHeight ?? 40 };
    setPos(clampPos({ x: e.clientX - d.offsetX, y: e.clientY - d.offsetY }, size));
  }

  function endDrag() {
    const d = drag.current;
    clearLongPress();
    if (!d) return;
    if (d.longPress) {
      skipClick.current = true;
      setDragging(false);
      setPos((prev) => {
        if (!prev) return prev;
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(prev));
        } catch {
          // 存不进去就只在这次会话里生效
        }
        return prev;
      });
    }
    drag.current = null;
  }

  // 拖动结束后浏览器还会补一次 click，别让它顺手把面板打开
  function onClick() {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    setOpen((v) => !v);
  }

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
        ref={btnRef}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={cn(
          'fixed z-30 flex touch-none select-none items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-medium shadow-lg',
          dragging ? 'cursor-grabbing scale-105 ring-2 ring-primary/30 shadow-xl' : 'cursor-pointer transition',
          pos ? '' : 'right-4 bottom-20 lg:right-6 lg:bottom-6',
          open ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground hover:opacity-95',
        )}
        aria-expanded={open}
        title="点一下打开对话，长按可以拖到别处"
      >
        <MessageCircle className="h-4 w-4" />
        问小山
      </button>

      {open && (
        <section
          className={cn(
            'fixed z-30 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl',
            pos ? '' : 'right-3 bottom-32 w-[min(94vw,392px)] lg:right-6 lg:bottom-20',
          )}
          style={pos ? drawerBox(pos, viewport) : { height: 'min(72vh, 560px)' }}
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
