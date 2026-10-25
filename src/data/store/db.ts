import Dexie, { type EntityTable } from 'dexie';
import type { Course, ExamItem, Preferences, SleepLog, UserProfile } from '@/types/contract';

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

/** 信息流「与我无关」负反馈（A7）：被屏蔽的 RawItem id，落库后刷新仍生效 */
export interface FeedMutedRecord {
  id: string;
  at: string; // ISO
}

/** 信息流收藏（B2）：收藏只存在本机 */
export interface FeedFavRecord {
  id: string;
  at: string; // ISO
}

/** 复习计划草案（B4）：一块 = 某天某个时段专门给某门考试 */
export interface ReviewBlockRecord {
  id: string;
  date: string; // 'YYYY-MM-DD'
  startMin: number;
  endMin: number;
  topic: string; // 考试名
  examId?: string;
  mastery?: number;
  done: boolean;
  at: string; // 生成/修改时间 ISO
}

/** 「没做」归因记录（§4.7 问为什么不问怎么办）：点「没做」后选原因时落一条 */
export interface MissReasonRecord {
  id?: number;
  topic: string;
  date: string; // 'YYYY-MM-DD'
  reason: string; // 起晚了 / 不饿 / 没时间 / 忘了
}

export const db = new Dexie('xiaoshan') as Dexie & {
  profiles: EntityTable<UserProfile, 'id'>;
  prefs: EntityTable<PrefsRecord, 'id'>;
  sleepLogs: EntityTable<SleepLog, 'date'>;
  choices: EntityTable<ChoiceRecord, 'id'>;
  compliance: EntityTable<ComplianceRecord, 'id'>;
  courses: EntityTable<Course, 'id'>;
  exams: EntityTable<ExamItem, 'id'>;
  feedMuted: EntityTable<FeedMutedRecord, 'id'>;
  feedFav: EntityTable<FeedFavRecord, 'id'>;
  reviewBlocks: EntityTable<ReviewBlockRecord, 'id'>;
  missReasons: EntityTable<MissReasonRecord, 'id'>;
};

db.version(1).stores({
  profiles: 'id',
  prefs: 'id',
  sleepLogs: 'date',
  choices: '++id, topic, at',
  compliance: '++id, topic, date',
});

// v2：课表 / 考试落库（A3——手动录入与教务 adapter 的存储载体）
db.version(2).stores({
  courses: 'id, dayOfWeek',
  exams: 'id, at',
});

// v3：信息流负反馈 / 收藏落库（A7 + B2——「与我无关」要跨刷新生效）
db.version(3).stores({
  feedMuted: 'id, at',
  feedFav: 'id, at',
});

// v4：复习计划草案落库（B4——草案要能拖、能勾、刷新还在）
db.version(4).stores({
  reviewBlocks: 'id, date',
});

// v5：「没做」归因落库（§4.7 问为什么不问怎么办——归因要跨天读到，才能转成次日建议）
db.version(5).stores({
  missReasons: '++id, topic, date',
});
