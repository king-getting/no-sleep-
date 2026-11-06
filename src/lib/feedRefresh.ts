import { db } from '@/data/store/db';
import type { RawItem } from '@/types/contract';

/**
 * 信息流刷新
 *
 * 课表这类数据只在本机，但通知是「别人发的」——必须能拿到新的。
 * 做法：App 启动 / 打开信息流时请求同源的 feed.json（带时间戳绕过缓存），
 * 校验后写入 IndexedDB；取不到就继续用包里烘好的快照，界面不报错。
 *
 * feed.json 由 .github/workflows/feed.yml 定时抓取学校站点生成并提交，
 * 提交后 Pages 自动重新发布，所以内容更新不需要你手动操作。
 */

const CACHE_KEY = 'feed-remote';
const LAST_KEY = 'xiaoshan:feed-refreshed-at';
const MIN_INTERVAL_MS = 30 * 60_000;

export interface FeedCache {
  items: RawItem[];
  fetchedAt: string | null;
}

export async function readFeedCache(): Promise<FeedCache> {
  const rec = await db.meta.get(CACHE_KEY).catch(() => null);
  const items = Array.isArray(rec?.value) ? (rec?.value as RawItem[]) : [];
  return { items, fetchedAt: localStorage.getItem(LAST_KEY) };
}

function looksLikeItem(x: unknown): x is RawItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.title === 'string' && typeof o.type === 'string' && Array.isArray(o.tags);
}

export interface RefreshResult {
  ok: boolean;
  count: number;
  message: string;
}

/**
 * 拉一次远端信息流。
 * @param force 忽略 30 分钟节流（用户手动点刷新时用）
 */
export async function refreshFeed(force = false): Promise<RefreshResult> {
  const last = localStorage.getItem(LAST_KEY);
  if (!force && last && Date.now() - new Date(last).getTime() < MIN_INTERVAL_MS) {
    return { ok: true, count: 0, message: '刚刚更新过' };
  }

  try {
    const url = `${import.meta.env.BASE_URL}feed.json?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, count: 0, message: `暂时没有新的通知（HTTP ${res.status}）` };

    const data: unknown = await res.json();
    if (!Array.isArray(data)) return { ok: false, count: 0, message: '通知文件格式不对' };

    const items = data.filter(looksLikeItem);
    if (items.length === 0) return { ok: false, count: 0, message: '通知文件是空的' };

    await db.meta.put({ key: CACHE_KEY, value: items });
    localStorage.setItem(LAST_KEY, new Date().toISOString());
    return { ok: true, count: items.length, message: `已更新 ${items.length} 条` };
  } catch {
    // 断网 / 文件不存在：静默用本地快照，不打扰用户
    return { ok: false, count: 0, message: '离线，用的是本机快照' };
  }
}
