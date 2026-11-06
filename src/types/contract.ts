/**
 * 小山 · 报告契约类型（docs/report-contract.md 的唯一代码实现）
 *
 * 纪律：
 * - UI 只消费本文件定义的 Schema 与编排事件流，禁止 import 引擎内部
 * - 契约变更 = 双方确认 + commit message `docs(contract): …`
 *
 * v1.1 扩展（相对文档 v1，已在文档中同步注明）：
 * - DirectionResult 增加 suggestions / conflictClaims 两个可选字段：
 *   方向 除了产出事实 Finding，还可以直接产出结构化建议草案与冲突主张，
 *   由编排器汇总、仲裁器配对后进入报告
 * - Suggestion 增加 slot 字段，标记该建议属于哪个报告时段
 */

// ── 基础标识 ────────────────────────────────────────────────

export type DirectionId = 'academic' | 'life' | 'health' | 'schedule';

export type Capability =
  | 'course.query'
  | 'exam.query' // 学习
  | 'canteen.recommend'
  | 'weather' // 生活
  | 'sleep.assess'
  | 'fatigue.warn' // 健康
  | 'timeblock.analyze'
  | 'ddl.warn'; // 日程

/** 置信度：0=猜测 … 3=确定 */
export type Confidence = 0 | 1 | 2 | 3;

export type Mode = 'normal' | 'exam';

// ── 领域模型（数据层与 方向 共用）───────────────────────────

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
  /** 示例数据标签：诚实原则，示例数据也不假装是真的 */
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
  /** 习惯测评结果：只用来调排期与建议参数，不是心理诊断 */
  traits?: HabitTraits;
  /** 学期第一周的周一（YYYY-MM-DD）；月视图用它换算「第几周」 */
  semesterStart?: string;
}

/**
 * 任务习惯倾向（测评产出）
 *
 * 四个维度都直接对应排期算法里的一个参数，测完不是存着看的：
 *   rhythm     → 复习时段优先（上午 / 晚上）
 *   structure  → 排期提前几天（计划型更早铺开）
 *   focus      → 单块复习时长（30 / 60 / 90 分钟）
 *   drive      → 提前量与每日配额（压线型不给太早的排期，避免白排）
 */
export interface HabitTraits {
  rhythm: 'morning' | 'night';
  structure: 'planner' | 'flexible';
  focus: 'sprint' | 'steady' | 'deep';
  drive: 'deadline' | 'steady';
  takenAt: string;
  /** 各维度原始分（-3..3），阈值以后可以调，不必重新答题 */
  scores: { rhythm: number; structure: number; focus: number; drive: number };
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
  /** 上课的教学周（1 起，如 [1,3,5]）；不填 = 每周都上 */
  weeks?: number[];
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
  /** 发布单位（真实来源才填，界面上作为出处显示） */
  source?: string;
  /** 发布日期，YYYY-MM-DD */
  publishedAt?: string;
  /** 原文链接（爬取快照带上，点开看全文；离线时打不开，界面要说明） */
  url?: string;
}

// ── 方向 模块接口（契约 §1）─────────────────────────────────

export interface DirectionContext {
  user: UserProfile; // 只读快照
  preferences: Preferences; // 方向只读与自己相关的部分
  mode: Mode;
  now: Date;
}

export interface Evidence {
  directionId: DirectionId;
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

/** 冲突主张：方向 对某个时段/资源的方案主张，由仲裁器配对成冲突卡 */
export interface ConflictClaim {
  topic: string; // 如 'tonight-slot'（明晚空档怎么用）
  side: string; // 主张标识：'study' | 'health' …
  plan: ConflictPlan;
}

export interface DirectionResult {
  directionId: DirectionId;
  findings: Finding[];
  /** v1.1：结构化建议草案（选项卡组） */
  suggestions?: Suggestion[];
  /** v1.1：冲突主张，交给仲裁器 */
  conflictClaims?: ConflictClaim[];
}

export interface DirectionModule {
  id: DirectionId;
  name: string; // 展示名：学习 / 生活 / 健康 / 日程
  version: string;
  capabilities: Capability[];
  defaultWeight: number; // 生存模式下由编排器动态调整
  enabled: boolean; // 设置里可按方向单独启停
  run(ctx: DirectionContext): Promise<DirectionResult>;
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
  /** 动作 + 取舍。例：「去一食堂吃（省 7 元）」。只写对象名的话，用户得自己从 pros 里拼出取舍 */
  title: string;
  /** 对象与地点。例：「一食堂二楼 · 12:10 前是低峰」 */
  note?: string;
  /** 时间锚：「今天 12:00 前」「明早 7:40 出门」。跨时段看报告时，没有它不知道还来不来得及 */
  when?: string;
  cost: { money?: number; timeMin?: number; effort?: 1 | 2 | 3 };
  /** 一餐的结构标签（v1.7）：只讲蔬菜 / 蛋白 / 油这类能自查的层级，**不报热量** */
  nutrition?: MealNutrition;
  pros: string[]; // 优势（≤2 条，与 cons 逐条对应）
  cons: string[]; // 代价（≤2 条）
  /** 不选这一项时，默认会发生什么。不替人决定，但要让人知道「什么都不做」的后果 */
  fallback?: string;
  impacts: Impact[]; // 可能影响：必须可观察，禁止「概率更高」这类套话
  evidences: Evidence[]; // 「为什么」展开渲染
  /**
   * 其他方向对这条建议的评审（v1.4）：一方一利一弊，带当时的有效权重。
   * 由编排器在汇总阶段按各方向的域规则算出来，不是 UI 编的漂亮话。
   */
  reviews?: DirectionReview[];
}

/** 跨方向评审：别的方向怎么看这条建议 */
export interface DirectionReview {
  directionId: DirectionId;
  /** 当时的有效权重（生存模式下与 defaultWeight 不同） */
  weight: number;
  /** 它认可这一点 */
  pro: string;
  /** 它不放心这一点 */
  con: string;
  /**
   * 这条建议对它那一域的影响强度（0–1）。
   * 只由它自己的数据算：学习看占用 / 到下一节课的窗口，生活看花销 / 餐标，
   * 健康看占用 / 睡眠余量，日程看占用 / 今天剩余机动时间。
   * UI 拿它排出「影响最大 / 最小」。
   */
  impact: number;
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
  directionId: DirectionId; // 预测来源
}

// ── 冲突卡 Schema（契约 §3）──────────────────────────────────

export interface ConflictPlan extends OptionCard {
  directionId: DirectionId; // 主张方
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
  | { kind: 'warning'; text: string; directionId: DirectionId }
  | { kind: 'recap'; stats: RecapStats }
  | { kind: 'preview'; items: string[] }
  | {
      kind: 'analysis';
      lines: { text: string; directionId?: DirectionId }[];
      advice: string;
      by: 'model' | 'rules';
    }
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
  fetch(type: string, ctx: DirectionContext): Promise<RawItem[]>;
}

// ── 编排事件流（契约 §6）─────────────────────────────────────

export type OrchestratorEvent =
  | { type: 'run:start'; trigger: string } // 'noon-report' | 'user-ask'
  | { type: 'direction:start'; directionId: DirectionId }
  | { type: 'direction:done'; directionId: DirectionId; result: DirectionResult }
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
