import { db } from '@/data/store/db';
import type { ChatTurn } from '@/agent/chat';

/**
 * 对话记忆（本机）
 *
 * 只存这台设备的 IndexedDB，不联网、不同步。上限 200 条，超出丢最旧的：
 * 目的是「下次打开还记得上次聊到哪」，不是日志归档。
 */

export interface ChatRecord extends ChatTurn {
  id?: number;
  at: number;
}

const LIMIT = 200;

export async function loadChat(limit = 60): Promise<ChatTurn[]> {
  const rows = await db.chat.orderBy('at').reverse().limit(limit).toArray();
  return rows
    .reverse()
    .map((r) => ({
      role: r.role,
      text: r.text,
      ...(r.actions?.length ? { actions: r.actions } : {}),
      ...(r.error ? { error: r.error } : {}),
    }));
}

export async function appendChat(turn: ChatTurn): Promise<void> {
  await db.chat.add({ ...turn, at: Date.now() });
  const total = await db.chat.count();
  if (total > LIMIT) {
    const extra = await db.chat.orderBy('at').limit(total - LIMIT).primaryKeys();
    if (extra.length) await db.chat.bulkDelete(extra as number[]);
  }
}

export async function clearChat(): Promise<void> {
  await db.chat.clear();
}
