import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarClock, Check, GripVertical, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtMin } from '@/types/contract';
import {
  clearReviewBlocks,
  dateKey,
  deleteReviewBlock,
  generateReviewPlan,
  listReviewBlocks,
  moveReviewBlockToDate,
  swapReviewBlocks,
  updateReviewBlock,
  type ReviewBlock,
} from '@/data/store/review';

const WEEK_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function dateLabel(date: string): { week: string; md: string } {
  const d = new Date(`${date}T00:00:00`);
  const idx = (d.getDay() + 6) % 7;
  return { week: WEEK_LABEL[idx], md: `${d.getMonth() + 1}/${d.getDate()}` };
}

function durText(block: ReviewBlock): string {
  return `${block.endMin - block.startMin} 分钟`;
}

export default function Plan() {
  const [blocks, setBlocks] = useState<ReviewBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    setBlocks(await listReviewBlocks());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const map = new Map<string, ReviewBlock[]>();
    for (const b of blocks) {
      const arr = map.get(b.date) ?? [];
      arr.push(b);
      map.set(b.date, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => ({ date, items: items.sort((a, b) => a.startMin - b.startMin) }));
  }, [blocks]);

  const total = blocks.reduce((sum, b) => sum + (b.endMin - b.startMin), 0);
  const doneCount = blocks.filter((b) => b.done).length;

  const regenerate = async () => {
    setBusy(true);
    try {
      const rows = await generateReviewPlan(new Date());
      await load();
      toast.success(rows.length > 0 ? `已按考试重排 ${rows.length} 段复习` : '7 天内没有要准备的考试');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    await clearReviewBlocks();
    await load();
    toast.success('草案已清空');
  };

  const toggleDone = async (block: ReviewBlock) => {
    await updateReviewBlock(block.id, { done: !block.done });
    await load();
  };

  const remove = async (block: ReviewBlock) => {
    await deleteReviewBlock(block.id);
    await load();
    toast.success('已删掉这一段');
  };

  const onPointerDown = (e: React.PointerEvent, block: ReviewBlock) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDragId(block.id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !dragStart.current) return;
    const moved = Math.abs(e.clientX - dragStart.current.x) + Math.abs(e.clientY - dragStart.current.y);
    if (moved < 6) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const card = el?.closest('[data-block-id]') as HTMLElement | null;
    const day = el?.closest('[data-day-date]') as HTMLElement | null;
    setOverId(card?.dataset.blockId ?? null);
    setOverDate(day?.dataset.dayDate ?? null);
  };

  const finishDrag = async () => {
    const target = overId;
    const targetDate = overDate;
    const from = dragId;
    setDragId(null);
    setOverId(null);
    setOverDate(null);
    dragStart.current = null;
    if (!from) return;
    if (target && target !== from) {
      await swapReviewBlocks(from, target);
      await load();
      toast.success('已和那一段互换时段');
      return;
    }
    if (!target && targetDate) {
      const ok = await moveReviewBlockToDate(from, targetDate);
      await load();
      toast[ok ? 'success' : 'error'](ok ? '已挪到这一天' : '这一天排不下了，换个时间试试');
    }
  };

  return (
    <div className="mx-auto min-h-[100dvh] max-w-4xl px-4 pb-24 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">复习安排</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按考试倒序和掌握度排的空档，可以拖动互换时段，也可以勾掉已经做完的。
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={regenerate} disabled={busy} size="sm">
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? '重排中' : '按考试重排'}
          </Button>
          <Button onClick={clearAll} variant="outline" size="sm">
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </header>

      {blocks.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="font-medium">
            共 {blocks.length} 段 · {Math.round(total / 60)} 小时
          </span>
          <span className="text-muted-foreground">已完成 {doneCount} 段</span>
          <span className="text-muted-foreground">拖动卡片可互换时段，拖到某一天的分组里可以整块挪过去</span>
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有复习草案</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            考试临近时，小山会把手边的整块空档排成复习块；现在也可以手动点「按考试重排」生成一份。
          </p>
          <Button className="mt-4" size="sm" onClick={regenerate}>
            生成草案
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {days.map(({ date, items }) => {
            const { week, md } = dateLabel(date);
            const isToday = date === dateKey(new Date());
            return (
              <section
                key={date}
                data-day-date={date}
                className={`rounded-xl border bg-card p-3 transition ${
                  overDate === date && !overId ? 'border-primary/60 bg-primary/5' : ''
                }`}
              >
                <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
                  {week}
                  <span className="text-xs font-normal text-muted-foreground">{md}</span>
                  {isToday && <Badge variant="secondary" className="text-[10px]">今天</Badge>}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{items.length} 段</span>
                </h2>
                <ul className="space-y-2">
                  {items.map((block) => {
                    const dragging = dragId === block.id;
                    const isOver = overId === block.id && dragId !== block.id;
                    return (
                      <li
                        key={block.id}
                        data-block-id={block.id}
                        className={`flex items-start gap-3 rounded-lg border bg-background px-3 py-2 transition ${
                          dragging ? 'opacity-50' : ''
                        } ${isOver ? 'ring-2 ring-primary/60' : ''}`}
                      >
                        <button
                          type="button"
                          aria-label="拖动调整"
                          className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing"
                          onPointerDown={(e) => onPointerDown(e, block)}
                          onPointerMove={onPointerMove}
                          onPointerUp={finishDrag}
                          onPointerCancel={finishDrag}
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className={`text-sm font-medium ${block.done ? 'text-muted-foreground line-through' : ''}`}>
                              {block.topic}
                            </span>
                            {typeof block.mastery === 'number' && (
                              <span className="text-[11px] text-muted-foreground">掌握度自评 {block.mastery}/5</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {fmtMin(block.startMin)}–{fmtMin(block.endMin)} · {durText(block)}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant={block.done ? 'secondary' : 'outline'}
                            className="h-7 px-2 text-xs"
                            onClick={() => toggleDone(block)}
                            aria-label={block.done ? '标记为未完成' : '标记为已完成'}
                          >
                            <Check className="mr-0.5 h-3 w-3" />
                            {block.done ? '已完成' : '做完'}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={() => remove(block)}
                            aria-label="删除这一段"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <TriangleAlert className="h-3.5 w-3.5" />
        草案只排到 22:30，不占上课时间也不占午饭；考前夜会被健康 Agent 拦一次，而不是默默让你熬。
      </p>

      <Link to="/week" className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        看看这周的真实课表
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
