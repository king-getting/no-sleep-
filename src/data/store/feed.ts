import { db } from '@/data/store/db';

/**
 * 信息流的用户反馈存储（A7 配套）
 *
 * 「与我无关」= 负反馈 → 同类条目沉底；「收藏」= 正反馈（本期只做记录 + 标记，不参与打分）。
 * 单独建表而不是塞进 Preferences：Preferences 是契约里的画像，改动会牵动 A 侧契约评审；
 * 这两张表纯本地、纯 UI 行为，用 db.version(3) 追加即可（见 INTEGRATION.md）。
 */

export interface FeedMutedRecord {
  id: string; // RawItem.id
  at: string; // ISO
}

export interface FeedFavRecord {
  id: string;
  at: string;
}

export async function muteItem(id: string): Promise<void> {
  await db.feedMuted.put({ id, at: new Date().toISOString() });
}

export async function unmuteItem(id: string): Promise<void> {
  await db.feedMuted.delete(id);
}

export async function mutedIds(): Promise<Set<string>> {
  return new Set((await db.feedMuted.toArray()).map((r) => r.id));
}

/** 收藏切换，返回切换后的状态 */
export async function toggleFav(id: string): Promise<boolean> {
  const exists = await db.feedFav.get(id);
  if (exists) {
    await db.feedFav.delete(id);
    return false;
  }
  await db.feedFav.put({ id, at: new Date().toISOString() });
  return true;
}

export async function favIds(): Promise<Set<string>> {
  return new Set((await db.feedFav.toArray()).map((r) => r.id));
}

/** 设置页「清除全部本机数据」时一并清理 */
export async function clearFeedState(): Promise<void> {
  await db.feedMuted.clear();
  await db.feedFav.clear();
}
