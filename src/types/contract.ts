/**
 * 小山 · Agent 契约类型（docs/agent-contract.md 的唯一代码实现）
 *
 * 纪律：
 * - UI 只消费本文件定义的 Schema 与编排事件流，禁止 import 引擎内部
 * - 契约变更 = 双方确认 + commit message `docs(contract): …`
 *
 * v1.1 扩展（相对文档 v1，已在文档中同步注明）：
 * - AgentResult 增加 suggestions / conflictClaims 两个可选字段：
 *   Agent 除了产出事实 Finding，还可以直接产出结构化建议草案与冲突主张，
 *   由编排器汇总、仲裁器配对后进入报告
 * - Suggestion 增加 slot 字段，标记该建议属于哪个报告时段
 */

// ── 基础标识 ────────────────────────────────────────────────

export type AgentId = 'academic' | 'life' | 'health' | 'schedule';

export type Capability =
  | 'course.query'
  | 'exam.query' // 教务
  | 'canteen.recommend'
  | 'weather' // 生活
  | 'sleep.assess'
  | 'fatigue.warn' // 健康
  | 'timeblock.analyze'
  | 'ddl.warn'; // 日程

/** 置信度：0=猜测 … 3=确定 */
export type Confidence = 0 | 1 | 2 | 3;

export type Mode = 'normal' | 'exam';

// ── 领域模型（数据层与 Agent 共用）───────────────────────────

export type Campus = 'guizishan' | 'nanhu';

export interface Identity {
  level: 'undergrad' | 'grad';
  grade: string; // '大二' | '研一' …
  college: string; // '计算机学院'
  major?: string;
  campus: Campus;
}

export interface UserProfile {
  id: string;
  identity: Identity;
  /** 月度餐标（元），onboarding 自设 */
  mealBudgetMonthly: number;
  /** 知情选填的身体基线 */
  bodyBaseline?: { heightCm?: number; weightKg?: number };
  /** 示例数据标签：诚实原则，演示数据不假装是真的 */
  isDemo?: boolean;
}

export interface Preferences {
  chronotype: 'early' | 'night';
  foodPriority: 'food' | 'saving' | 'health';
  napHabit: 'always' | 'sometimes' | 'never';
  /** 遵从度画像：topic -> 展示/执行次数（不服从 = 偏好学习） */
  compliance: Record<string, { shown: number; done: number }>;
  /** 冲突裁决记忆：topic -> 上次选择（裁决一次，不再重复打扰） */
  conflictChoices: Record<string, 'A' | 'B'>;
  /** v1.10「没做」归因：topic -> 最近一次原因（起晚了/不饿/没时间/忘了），次日建议据此转化 */
  missReasons?: Record<string, string>;
  /** v1.10 一键「不再追问」的 topic：不再出现「做了 / 没做」标记 */
  noAsk?: Record<string, true>;
}

/** 课程（时间统一用「当日分钟数」表示，如 8:00 = 480） */
export interface Course {
  id: string;
  name: string;
  teacher?: string;
  location: string;
  /** 1=周一 … 7=周日 */
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startMin: number;
  endMin: number;
}

export interface ExamItem {
  id: string;
  title: string;
  kind: 'exam' | 'ddl';
  /** ISO 时间串 */
  at: string;
  /** 掌握度自评 1(差)–5(好)，生存模式排复习用 */
  mastery?: 1 | 2 | 3 | 4 | 5;
}

export interface SleepLog {
  /** 'YYYY-MM-DD'，指这一晚的睡眠 */
  date: string;
  hours: number;
  /** 入睡时间（分钟，跨天则 >1440，如 25:30 = 1530） */
  bedTimeMin?: number;
}

/** 时间块切分：上课 / 整块空档（≥2h） / 碎片（<2h） */
export interface TimeBlock {
  kind: 'class' | 'free' | 'fragment';
  startMin: number;
  endMin: number;
  label?: string;
}

/** 数据源原始条目（adapter 层统一返回） */
export interface RawItem {
  id: string;
  type: string; // 'notice' | 'canteen-window' | 'weather' …
  title: string;
  body?: string;
  tags: string[];
  campus?: Campus | 'both';
  /** 受众过滤：年级 / 身份标签 */
  audience?: string[];
  payload?: Record<string, unknown>;
}

// ── Agent 模块接口（契约 §1）─────────────────────────────────

export interface AgentContext {
  user: UserProfile; // 只读快照
  preferences: Preferences; // Agent 只读与自己相关的部分
  mode: Mode;
  now: Date;
}

export interface Evidence {
  agentId: AgentId;
  text: string; // 例：「该窗口 12:10 前为低峰」
  confidence: Confidence;
}

export interface Finding {
  id: string;
  type: 'fact' | 'suggestion' | 'warning' | 'conflict';
  topic: string; // '午饭' | '睡眠' | '复习' …
  confidence: Confidence;
  summary: string;
  evidences?: Evidence[];
}

/** 冲突主张：Agent 对某个时段/资源的方案主张，由仲裁器配对成冲突卡 */
export interface ConflictClaim {
  topic: string; // 如 'tonight-slot'（明晚空档怎么用）
  side: string; // 主张标识：'study' | 'health' …
  plan: ConflictPlan;
}

export interface AgentResult {
  agentId: AgentId;
  findings: Finding[];
  /** v1.1：结构化建议草案（选项卡组） */
  suggestions?: Suggestion[];
  /** v1.1：冲突主张，交给仲裁器 */
  conflictClaims?: ConflictClaim[];
}

export interface AgentModule {
  id: AgentId;
  name: string; // 展示名：教务 / 生活 / 健康 / 日程
  version: string;
  capabilities: Capability[];
  defaultWeight: number; // 生存模式下由编排器动态调整
  enabled: boolean; // 设置里可按 Agent 单独启停
  run(ctx: AgentContext): Promise<AgentResult>;
}

// ── 选项卡 Schema（契约 §2）──────────────────────────────────

export type ReportSlot = 'morning' | 'noon' | 'evening';

export interface Suggestion {
  id: string;
  topic: string; // 「午饭吃什么」
  priority: 1 | 2 | 3;
  /** 所属报告时段（v1.1） */
  slot: ReportSlot;
  sourceFindingIds: string[]; // 关联 Finding，可回溯
  options: OptionCard[]; // 2–3 张
}

export interface OptionCard {
  id: string;
  title: string; // 「一食堂二楼经济窗口」
  cost: { money?: number; timeMin?: number };
  /** 一餐的结构标签（v1.7）：只讲蔬菜 / 蛋白 / 油这类能自查的层级，**不报热量** */
  nutrition?: MealNutrition;
  pros: string[]; // 优势
  cons: string[]; // 代价
  impacts: Impact[]; // 可能影响（决策模拟）
  evidences: Evidence[]; // 「为什么」展开渲染
}

/**
 * 结构标签，0/1/2 三级。刻意不引入 kcal：
 * 食堂菜品没有可信的热量数据来源，编一个数字写进产品比不写更糟。
 */
export interface MealNutrition {
  veg: 0 | 1 | 2; // 0 没有蔬菜 / 1 偏少 / 2 到位
  protein: 0 | 1 | 2; // 0 偏少 / 1 够 / 2 充足
  oil: 0 | 1 | 2; // 0 偏重 / 1 适中 / 2 偏轻
}

export interface Impact {
  horizon: 'short' | 'long';
  text: string; // 「明早前两节课注意力下降风险高」
  agentId: AgentId; // 预测来源
}

// ── 冲突卡 Schema（契约 §3）──────────────────────────────────

export interface ConflictPlan extends OptionCard {
  agentId: AgentId; // 主张方
}

export interface ConflictCard {
  id: string;
  topic: string;
  level: 'L1' | 'L2'; // L1=已自动合并（仅记录）；L2=需用户裁决
  planA: ConflictPlan;
  planB: ConflictPlan;
  resolvedBy?: 'user' | 'orchestrator';
  /** 是否按历史偏好预填（裁决一次，不重复打扰） */
  preset?: boolean;
  /** 上次选过的方案，用于把「预填」真正高亮出来（契约 v1.6） */
  presetChoice?: 'A' | 'B';
}

// ── 报告 = 区块拼装（契约 §4）─────────────────────────────────

export type ReportType = 'morning' | 'noon' | 'evening' | 'exam-day' | 'exam-week' | 'exam-done';

export interface OverviewItem {
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
  /** 可选：这一行点得动，跳到站内某个路由（如「今日课程」→ `/week?dow=3`）。v1.3 */
  link?: string;
}

export interface RecapStats {
  items: { label: string; value: string }[];
}

export type ReportBlock =
  | { kind: 'overview'; items: OverviewItem[] }
  | { kind: 'suggestionGroup'; suggestion: Suggestion }
  | { kind: 'conflict'; conflict: ConflictCard }
  | { kind: 'warning'; text: string; agentId: AgentId }
  | { kind: 'recap'; stats: RecapStats }
  | { kind: 'preview'; items: string[] }
  // 契约 v1.2（补丁新增）：考场物品清单，仅生存模式考试日使用
  | { kind: 'checklist'; title: string; items: string[] };

export type BlockKind = ReportBlock['kind'];

export interface Report {
  type: ReportType;
  generatedAt: Date;
  blocks: ReportBlock[];
}

// ── 数据源 Adapter 接口（契约 §5）─────────────────────────────

export interface DataSourceAdapter {
  id: string; // 'mock-canteen' | 'mock-notice' | 'jwgl' …
  provides: string[]; // 提供的数据类型
  fetch(type: string, ctx: AgentContext): Promise<RawItem[]>;
}

// ── 编排事件流（契约 §6）─────────────────────────────────────

export type OrchestratorEvent =
  | { type: 'run:start'; trigger: string } // 'noon-report' | 'user-ask'
  | { type: 'agent:start'; agentId: AgentId }
  | { type: 'agent:done'; agentId: AgentId; result: AgentResult }
  | { type: 'merge:applied'; text: string } // L1 自动合并结果
  | { type: 'conflict:detected'; conflict: ConflictCard } // L2 弹出冲突卡
  | { type: 'report:composed'; report: Report };

// ── 工具函数 ────────────────────────────────────────────────

/** 分钟数 → 'HH:MM' */
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 月度餐标 → 每日参考值 */
export function dailyBudget(profile: UserProfile): number {
  return profile.mealBudgetMonthly / 30;
}

/** Date → 契约的 dayOfWeek（1=周一 … 7=周日） */
export function dayOfWeek(d: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const day = d.getDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** 「没做」归因的可选项（v1.10，§4.7）：UI 与编排器共用这一份，别各写各的 */
export const MISS_REASON_OPTIONS = ['起晚了', '不饿', '没时间', '忘了'] as const;
