import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { queryFeed } from '@/data/adapters';
import { favIds, mutedIds, muteItem, toggleFav, unmuteItem } from '@/data/store/feed';
import { getPreferences, getProfile } from '@/data/store/profile';
import type { ScoredItem } from '@/data/relevance';
import type { AgentContext, RawItem } from '@/types/contract';

/**
 * 首页「今日校园」信息流（dev-tasks B2 × A7）
 *
 * 与 A7 的分工：本页只负责「展示 + 收集反馈」，排序与理由全部来自 rankFeed()：
 *   - 每条卡片都有一行「为什么推给我」（可解释，不做黑箱）
 *   - 「与我无关」写进本地 feedMuted 表，下次刷新该条直接消失
 *   - 「收藏」写进 feedFav 表，仅做标记（本期不参与打分）
 */

const TYPE_LABEL: Record<string, string> = {
  notice: '教务 / 通知',
  express: '快递',
  'canteen-window': '食堂',
  convenience: '生活服务',
  weather: '天气',
};

function itemTitleOf(item: RawItem): string {
  return item.title;
}

export default function Feed() {
  const [items, setItems] = useState<ScoredItem[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [mutedCount, setMutedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [user, preferences] = await Promise.all([getProfile(), getPreferences()]);
      const ctx: AgentContext = { user, preferences, mode: 'normal', now: new Date() };
      const [ranked, fav, muted] = await Promise.all([queryFeed(ctx), favIds(), mutedIds()]);
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
  }, []);

  const handleUnmuteAll = useCallback(async () => {
    const ids = await mutedIds();
    await Promise.all([...ids].map((id) => unmuteItem(id)));
    toast('已恢复全部信息', { description: '被「与我无关」过滤掉的条目回来了。' });
    await load();
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-xl font-bold">今日校园</h1>
          <p className="text-xs text-muted-foreground">
            教务、快递、食堂三类混排 · 每条都告诉你为什么推给你
          </p>
        </div>
        {mutedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void handleUnmuteAll()}>
            恢复 {mutedCount} 条
          </Button>
        )}
      </header>

      {loading && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">正在按你的身份排序…</p>}
      {error && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-destructive">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">暂时没有与你身份相关的信息。</p>
      )}

      <ul className="space-y-3">
        {items.map(({ item, reasons, score }) => (
          <li key={item.id} className="rounded-2xl border bg-card p-4 shadow-xs">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                {TYPE_LABEL[item.type] ?? item.type}
              </span>
              {item.campus && item.campus !== 'both' && <span>{item.campus === 'guizishan' ? '桂子山' : '南湖'}</span>}
              <span className="ml-auto tabular-nums">相关度 {score.toFixed(1)}</span>
            </div>
            <h2 className="text-base font-medium leading-snug">{itemTitleOf(item)}</h2>
            {item.body && <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {reasons.map((r) => (
                <span key={r} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  为什么推给我：{r}
                </span>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <Button variant={favs.has(item.id) ? 'default' : 'outline'} size="sm" onClick={() => void handleFav(item)}>
                {favs.has(item.id) ? '已收藏' : '收藏'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void handleMute(item)}>
                与我无关
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
