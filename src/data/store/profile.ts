import { db } from './db';
import { DEMO_PREFERENCES, DEMO_PROFILE } from '@/data/mock/profile';
import { buildDemoSleepLogs } from '@/data/mock/sleep';
import type { Preferences, SleepLog, UserProfile } from '@/types/contract';

/**
 * 画像 / 偏好 / 记录的读写入口。
 * 首次启动填充示例数据（带 isDemo 标签，设置里可一键清除）。
 */

let seeding: Promise<void> | null = null;

/** 幂等：首次调用时填充示例数据 */
export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    const count = await db.profiles.count();
    if (count > 0) return;
    await db.transaction('rw', [db.profiles, db.prefs, db.sleepLogs], async () => {
      await db.profiles.put(DEMO_PROFILE);
      await db.prefs.put({ id: 'prefs', value: DEMO_PREFERENCES });
      await db.sleepLogs.bulkPut(buildDemoSleepLogs());
    });
  })();
  return seeding;
}

export async function getProfile(): Promise<UserProfile> {
  await ensureSeeded();
  const p = await db.profiles.get('me');
  if (!p) throw new Error('本地画像不存在：请先完成 onboarding');
  return p;
}

export async function getPreferences(): Promise<Preferences> {
  await ensureSeeded();
  const rec = await db.prefs.get('prefs');
  if (!rec) throw new Error('本地偏好不存在');
  return rec.value;
}

export async function savePreferences(value: Preferences): Promise<void> {
  await db.prefs.put({ id: 'prefs', value });
}

export async function getSleepLogs(): Promise<SleepLog[]> {
  await ensureSeeded();
  return db.sleepLogs.orderBy('date').toArray();
}

/** 记录一次选项卡点选（表达意图，不是执行确认） */
export async function recordChoice(suggestionId: string, optionId: string, topic: string): Promise<void> {
  await db.choices.add({ suggestionId, optionId, topic, at: new Date().toISOString() });
}

/** 晚间报告一键标记「做了 / 没做」，同时更新遵从度画像 */
export async function markCompliance(topic: string, done: boolean): Promise<void> {
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  await db.compliance.add({ topic, date: dateStr, done });

  const prefs = await getPreferences();
  const stat = prefs.compliance[topic] ?? { shown: 1, done: 0 };
  stat.done += done ? 1 : 0;
  stat.shown += 1; // 这次「追问」本身也算一次展示
  prefs.compliance[topic] = stat;
  await savePreferences(prefs);
}

/** 冲突裁决记忆：同类冲突下次默认预填上次选择 */
export async function rememberConflictChoice(topic: string, choice: 'A' | 'B'): Promise<void> {
  const prefs = await getPreferences();
  prefs.conflictChoices[topic] = choice;
  await savePreferences(prefs);
}

/** 一键清除示例数据（诚实原则：可退出演示） */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.profiles, db.prefs, db.sleepLogs, db.choices, db.compliance], async () => {
    await Promise.all([
      db.profiles.clear(),
      db.prefs.clear(),
      db.sleepLogs.clear(),
      db.choices.clear(),
      db.compliance.clear(),
    ]);
  });
  seeding = null;
}
