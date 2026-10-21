import Dexie, { type EntityTable } from 'dexie';
import type { Preferences, SleepLog, UserProfile } from '@/types/contract';

/**
 * 本地数据层（IndexedDB / Dexie）—— 本地优先的核心载体
 * 课表、睡眠、偏好、点选记录只存在这台设备上，不上传任何服务器。
 */

interface PrefsRecord {
  id: string; // 固定 'prefs'
  value: Preferences;
}

/** 点选选项卡 = 表达意图（设计文档 §4.6 轻闭环） */
export interface ChoiceRecord {
  id?: number;
  suggestionId: string;
  optionId: string;
  topic: string;
  at: string; // ISO
}

/** 晚间报告一键标记「做了 / 没做」 */
export interface ComplianceRecord {
  id?: number;
  topic: string;
  date: string; // 'YYYY-MM-DD'
  done: boolean;
}

export const db = new Dexie('xiaoshan') as Dexie & {
  profiles: EntityTable<UserProfile, 'id'>;
  prefs: EntityTable<PrefsRecord, 'id'>;
  sleepLogs: EntityTable<SleepLog, 'date'>;
  choices: EntityTable<ChoiceRecord, 'id'>;
  compliance: EntityTable<ComplianceRecord, 'id'>;
};

db.version(1).stores({
  profiles: 'id',
  prefs: 'id',
  sleepLogs: 'date',
  choices: '++id, topic, at',
  compliance: '++id, topic, date',
});
