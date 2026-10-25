import { db } from './db';
import { bootMode } from './boot';
import { MOCK_COURSES, buildMockExams } from '@/data/mock/courses';
import { DEMO_PREFERENCES, DEMO_PROFILE } from '@/data/mock/profile';
import { buildDemoSleepLogs } from '@/data/mock/sleep';
import type { Preferences, SleepLog, UserProfile } from '@/types/contract';

/**
 * 画像 / 偏好 / 睡眠 / 记录的读写入口。
 * 首次启动填充示例数据（带 isDemo 标签，设置里可一键清除）。
 */

let seeding: Promise<void> | null = null;

/** 幂等：首次调用时填充示例数据；示例模式下每次加载刷新示例考试，保证「DDL 在 40h 后」的演示形态 */
export function ensureSeeded(): Promise<void> {
  // 真实模式（已完成 onboarding）：不灌任何示例数据，避免示例成绩单混进用户数据
  if (bootMode() === 'real') return Promise.resolve();
  seeding ??= (async () => {
    const count = await db.profiles.count();
    if (count === 0) {
      await db.transaction('rw', [db.profiles, db.prefs, db.sleepLogs, db.courses, db.exams], async () => {
        await db.profiles.put(DEMO_PROFILE);
        await db.prefs.put({ id: 'prefs', value: DEMO_PREFERENCES });
        await db.sleepLogs.bulkPut(buildDemoSleepLogs());
        await db.courses.bulkPut(MOCK_COURSES);
        await db.exams.bulkPut(buildMockExams(new Date()));
      });
      return;
    }
    // 示例数据刷新：考试/DDL 是相对时间生成的，每次启动对齐到当前时间，演示永不过期
    const profile = await db.profiles.get('me');
    if (profile?.isDemo) {
      await db.exams.bulkPut(buildMockExams(new Date()));
    }
    // 兼容 v1 老库升级：课表为空时补种示例课表
    if ((await db.courses.count()) === 0) {
      await db.courses.bulkPut(MOCK_COURSES);
    }
  })();
  return seeding;
}

export async function getProfile(): Promise<UserProfile> {
  await ensureSeeded();
  const p = await db.profiles.get('me');
  if (!p) throw new Error('本地画像不存在：请先完成 onboarding');
  return p;
}

/** 写入 / 覆盖画像（onboarding 收尾与设置页编辑共用） */
export async function saveProfile(profile: UserProfile): Promise<void> {
  await db.profiles.put(profile);
}

/** 是否已有真实画像（App 用来决定要不要先走 onboarding） */
export async function hasProfile(): Promise<boolean> {
  const p = await db.profiles.get('me');
  return !!p && !p.isDemo;
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

/** 睡眠手动录入 / 修改（A4）：date 格式 'YYYY-MM-DD'，同一日期覆盖写 */
export async function upsertSleepLog(log: SleepLog): Promise<void> {
  await ensureSeeded();
  await db.sleepLogs.put(log);
}

export async function deleteSleepLog(date: string): Promise<void> {
  await db.sleepLogs.delete(date);
}

/** 记录一次选项卡点选（表达意图，不是执行确认） */
export async function recordChoice(suggestionId: string, optionId: string, topic: string): Promise<void> {
  await db.choices.add({ suggestionId, optionId, topic, at: new Date().toISOString() });
}

/** 晚间报告一键标记「做了 / 没做」，同时更新遵从度画像。
 *  没做时可带归因（§4.7）：原因落 missReasons 表并写进偏好，次日建议据此转化。 */
export async function markCompliance(topic: string, done: boolean, reason?: string): Promise<void> {
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  await db.compliance.add({ topic, date: dateStr, done });

  const prefs = await getPreferences();
  const stat = prefs.compliance[topic] ?? { shown: 0, done: 0 };
  stat.shown += 1; // 每次追问算一次展示
  if (done) stat.done += 1; // 只累计「真的做了」的次数
  prefs.compliance[topic] = stat;

  if (!done && reason) {
    await db.missReasons.add({ topic, date: dateStr, reason });
    prefs.missReasons = { ...prefs.missReasons, [topic]: reason };
  }
  if (done && prefs.missReasons?.[topic]) {
    // 做了就清掉旧归因：障碍已经不存在，别让昨天的原因继续污染今天的建议
    const next = { ...prefs.missReasons };
    delete next[topic];
    prefs.missReasons = next;
  }
  await savePreferences(prefs);
}

/** §4.7「不再追问」：某个主题以后不再出现「做了 / 没做」标记，关闭即停 */
export async function optOutNoAsk(topic: string): Promise<void> {
  const prefs = await getPreferences();
  prefs.noAsk = { ...prefs.noAsk, [topic]: true };
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
  await db.transaction('rw', [db.profiles, db.prefs, db.sleepLogs, db.choices, db.compliance, db.courses, db.exams, db.missReasons], async () => {
    await Promise.all([
      db.profiles.clear(),
      db.prefs.clear(),
      db.sleepLogs.clear(),
      db.choices.clear(),
      db.compliance.clear(),
      db.courses.clear(),
      db.exams.clear(),
      db.missReasons.clear(),
    ]);
  });
  seeding = null;
}
