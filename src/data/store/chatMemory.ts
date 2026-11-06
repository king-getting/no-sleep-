import { db } from '@/data/store/db';

/**
 * 长期记忆：模型从对话里总结出来的「关于你」的稳定事实
 *
 * 只存本机（IndexedDB 的 meta 表），只在对话时随系统提示一起发给模型。
 * 抽取有硬门槛：条目要短、要不重复、最多 12 条，凑不够就不写。
 */

const KEY = 'chat-memory';
const MAX_ITEMS = 12;
const MAX_LEN = 24;

export interface ChatMemory {
  items: string[];
  updatedAt: number;
  /** 上次抽取时已有的对话条数，用来判断「够不够再抽一次」 */
  extractedAtCount: number;
}

const EMPTY: ChatMemory = { items: [], updatedAt: 0, extractedAtCount: 0 };

export async function loadMemory(): Promise<ChatMemory> {
  const rec = await db.meta.get(KEY).catch(() => null);
  const v = rec?.value as ChatMemory | undefined;
  if (!v || !Array.isArray(v.items)) return { ...EMPTY };
  return {
    items: v.items.filter((x) => typeof x === 'string' && x.length > 0).slice(0, MAX_ITEMS),
    updatedAt: v.updatedAt ?? 0,
    extractedAtCount: v.extractedAtCount ?? 0,
  };
}

export async function saveMemory(items: string[], count: number): Promise<void> {
  const clean = [...new Set(items.map((x) => x.trim()).filter(Boolean))].slice(-MAX_ITEMS);
  const next: ChatMemory = { items: clean, updatedAt: Date.now(), extractedAtCount: count };
  await db.meta.put({ key: KEY, value: next });
}

export async function clearMemory(): Promise<void> {
  await db.meta.delete(KEY).catch(() => {});
}

/** 模型输出 → 可入库的条目；不合格就返回 null（不动旧记忆） */
export function validateMemory(raw: unknown, existing: string[]): string[] | null {
  const obj = raw as { items?: unknown } | null;
  const list = Array.isArray(obj?.items) ? obj.items : null;
  if (!list) return null;

  const clean: string[] = [];
  for (const x of list) {
    if (typeof x !== 'string') continue;
    const s = x.trim().replace(/\s+/g, ' ');
    if (s.length < 2 || s.length > MAX_LEN) continue;
    if (existing.includes(s) || clean.includes(s)) continue;
    clean.push(s);
  }
  if (clean.length === 0) return null;
  return [...existing, ...clean].slice(-MAX_ITEMS);
}
