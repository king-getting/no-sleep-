import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { queryFeed } from '@/data/adapters';
import { favIds, mutedIds, muteItem, toggleFav, unmuteItem } from '@/data/store/feed';
import { getPreferences, getProfile } from '@/data/store/profile';
import type { ScoredItem } from '@/data/relevance';
import { cn } from '@/lib/utils';
import type { AgentContext, RawItem } from '@/types/contract';

/**
 * 首页「今日校园」信息流（dev-tasks B2 × A7）
 *
 * 与 A7 的分工：本页只负责「展示 + 收集反馈」，排序与理由全部来自 rankFeed()：
 *   - 每条卡片都有一行「为什么推给我」（可解释，不做黑箱）
 *   - 「与我无关」写进本地 feedMuted 表，下次刷新该条直接消失
 *   - 收藏写进 feedFav 表；收藏夹单独一栏，连被「与我无关」过的也能翻回来
 */

const TYPE_LABEL: Record<string, string> = {
  notice: '教务 / 通知',
  express: '快递',
  'canteen-window': '食堂',
  convenience: '生活服务',
  weather: '天气',
};

/** 相关度分档：原始分（11.7 / 3.2）对用户没有意义，只保留档位，数值放进 title */
function relevanceBand(score: number): { label: string; className: string } {
  if (score >= 8) return { label: '高度相关', className: 'border-primary/30 bg-primary/5 text-primary' };
  if (score >= 4) return { label: '相关', className: 'border-border bg-secondary text-secondary-foreground' };
  return { label: '一般', className: 'border-border text-muted-foreground' };
}

export default function Feed() {
  const [items, setItems] = useState<ScoredItem[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [mutedCount, setMutedCount] = useState(0);
  const [tab, setTab] = useState<'all' | 'fav'>('all');
  const [type, setType] = useState<string>('all');
  const [openReasons, setOpenReasons] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [user, preferences] = await Promise.all([getProfile(), getPreferences()]);
      const ctx: AgentContext = { user, preferences, mode: 'normal', now: new Date() };
      // 连「与我无关」的一起拿：收藏夹要能翻回自己存过、后来又被屏蔽的条目
      const [ranked, fav, muted] = await Promise.all([queryFeed(ctx, { includeMuted: true }), favIds(), mutedIds()]);
      setItems(ranked);
      setFavs(fav);
      setMutedCount(muted.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMute = useCallback(
    async (item: RawItem) => {
      await muteItem(item.id);
      toast('已记下：这条与我无关', { description: '同类条目之后会沉底；可在设置里恢复。' });
      await load();
    },
    [load],
  );

  const handleFav = useCallback(async (item: RawItem) => {
    const on = await toggleFav(item.id);
    setFavs((prev) => {
      const next = new Set(prev);
      if (on) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    toast(on ? '已加入收藏' : '已取消收藏', { description: on ? '在「收藏」里随时能翻回来。' : undefined });
  }, []);

  const handleUnmuteAll = useCallback(async () => {
    const ids = await mutedIds();
    await Promise.all([...ids].map((id) => unmuteItem(id)));
    toast('已恢复全部信息', { description: '被「与我无关」过滤掉的条目回来了。' });
    await load();
  }, [load]);

  const toggleReasons = (id: string) =>
    setOpenReasons((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visible = useMemo(() => {
    const inTab = tab === 'fav' ? items.filter((x) => favs.has(x.item.id)) : items.filter((x) => !x.muted);
    return type === 'all' ? inTab : inTab.filter((x) => x.item.type === type);
  }, [items, favs, tab, type]);

  const allCount = items.filter((x) => !x.muted).length;
  const favCount = items.filter((x) => favs.has(x.item.id)).length;
  const types = useMemo(() => [...new Set(items.map((x) => x.item.type))], [items]);

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
      {/* 顶部固定在视口里：一屏能看三四条，翻到下面还能切「收藏」 */}
      <header className="sticky top-0 z-10 -mx-4 mb-3 bg-background/95 px-4 pb-2 pt-1 backdrop-blur">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-xl font-bold">今日校园</h1>
            <p className="text-xs text-muted-foreground">教务、快递、食堂混排 · 每条都告诉你为什么推给你</p>
          </div>
          {mutedCount > 0 && tab === 'all' && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void handleUnmuteAll()}>
              恢复 {mutedCount} 条
            </Button>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all' as const, label: '全部', count: allCount },
              { id: 'fav' as const, label: '收藏', count: favCount },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] transition-colors sm:px-3 sm:text-sm',
                tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t.label}
              <span className="ml-1 tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}

          <div className="flex items-center gap-1 overflow-x-auto sm:ml-auto">
            {['all', ...types].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  type === t
                    ? 'border-foreground/30 text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'all' ? '全部类型' : (TYPE_LABEL[t] ?? t)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">正在按你的身份排序…</p>}
      {error && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-destructive">{error}</p>}

      {!loading && !error && visible.length === 0 && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {tab === 'fav'
            ? '还没有收藏。点任意一条右上角的星标，就会出现在这里。'
            : type === 'all'
              ? '今天没有和你身份相关的新消息。'
              : '这个类型下暂时没有内容。'}
        </p>
      )}

      <ul className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {visible.map(({ item, reasons, score, muted }) => {
          const band = relevanceBand(score);
          const isFav = favs.has(item.id);
          const expanded = openReasons.has(item.id);
          const shown = expanded ? reasons : reasons.slice(0, 2);
          return (
            <li key={item.id} className={cn('rounded-2xl border bg-card p-4 shadow-xs', muted && 'opacity-80')}>
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                  {TYPE_LABEL[item.type] ?? item.type}
                </span>
                {item.campus && item.campus !== 'both' && <span>{item.campus === 'guizishan' ? '桂子山' : '南湖'}</span>}
                {muted && <span className="rounded-md border px-1.5 py-0.5 text-[11px]">已设为与我无关</span>}
                <span
                  className={cn('ml-auto rounded-full border px-2 py-0.5 text-[11px]', band.className)}
                  title={`相关度 ${score.toFixed(1)}`}
                >
                  {band.label}
                </span>
                <button
                  type="button"
                  onClick={() => void handleFav(item)}
                  aria-label={isFav ? '取消收藏' : '收藏'}
                  aria-pressed={isFav}
                  className={cn(
                    '-mr-1 rounded-full p-1.5 transition-colors',
                    isFav ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Star className={cn('h-4 w-4', isFav && 'fill-current')} />
                </button>
              </div>

              <h2 className="text-base font-medium leading-snug">{item.title}</h2>
              {item.body && <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>}

              {reasons.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {shown.map((r) => (
                    <span key={r} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                      为什么推给我：{r}
                    </span>
                  ))}
                  {reasons.length > 2 && (
                    <button
                      type="button"
                      onClick={() => toggleReasons(item.id)}
                      className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      {expanded ? '收起' : `还有 ${reasons.length - 2} 条`}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button variant={isFav ? 'default' : 'outline'} size="sm" onClick={() => void handleFav(item)}>
                  {isFav ? '已收藏' : '收藏'}
                </Button>
                {!muted && (
                  <Button variant="ghost" size="sm" onClick={() => void handleMute(item)}>
                    与我无关
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
