# 小山 · Agent 输出契约与模块接口（v1.7）

> 这是 A（引擎）与 B（体验）之间的**唯一接口**。两边对着这份契约各自开发，互不阻塞。
> 契约变更必须双方同步（每日站会对一遍）。

## 设计原则

1. **一切皆可插拔**：Agent、数据源、报告区块都是注册式模块——新增 = 加一个文件 + 注册一行
2. **功能开关到三级**：Agent 级（设置里启停）→ 能力级（capabilities）→ 区块级（报告配方裁剪）；MVP 砍功能 = 改配置，不改代码
3. **UI 只消费 Schema 和事件流**，永远不 import 引擎内部逻辑
4. **Mock 即实现**：mock 数据源与真实数据源实现同一接口，切换零成本

---

## 1. Agent 模块接口

```ts
// 每个 Agent 一个文件，实现此接口并在注册表登记
interface AgentModule {
  id: AgentId;                  // 'academic' | 'life' | 'health' | 'schedule'
  name: string;                 // 展示名：教务 / 生活 / 健康 / 日程
  version: string;
  capabilities: Capability[];   // 能力清单，编排器按能力发现模块
  defaultWeight: number;        // 默认权重（生存模式下由编排器动态调整）
  enabled: boolean;             // 用户可在设置里启停
  run(ctx: AgentContext): Promise<AgentResult>;
}

type Capability =
  | 'course.query' | 'exam.query'        // 教务
  | 'canteen.recommend' | 'weather'      // 生活
  | 'sleep.assess' | 'fatigue.warn'      // 健康
  | 'timeblock.analyze' | 'ddl.warn';    // 日程

interface AgentContext {
  user: UserProfile;            // 身份 / 课表 / 餐标 / 身体基线（只读快照）
  preferences: Preferences;     // 偏好与遵从度（Agent 只读与自己相关的部分）
  mode: 'normal' | 'exam';      // 当前模式（生存模式见设计文档 §4.8）
  now: Date;
}

interface AgentResult {
  agentId: AgentId;
  findings: Finding[];          // 本轮发现的全部事实 / 判断 / 建议 / 冲突主张
}

interface Finding {
  id: string;
  type: 'fact' | 'suggestion' | 'warning' | 'conflict';
  topic: string;                // '午饭' | '睡眠' | '复习' ...
  confidence: 0 | 1 | 2 | 3;    // 0=猜测 … 3=确定
  summary: string;
  evidences?: Evidence[];       // 支撑依据，渲染在「为什么」
}

interface Evidence {
  agentId: AgentId;
  text: string;                 // 例：「该窗口 12:10 前为低峰」
  confidence: 0 | 1 | 2 | 3;
}
```

## 2. 选项卡 Schema（建议的标准件）

```ts
interface Suggestion {
  id: string;
  topic: string;                          // 「午饭吃什么」
  priority: 1 | 2 | 3;
  sourceFindingIds: string[];             // 关联的 Finding id（可回溯）
  options: OptionCard[];                  // 2–3 张，见设计文档 §4.4
}

interface OptionCard {
  id: string;
  title: string;                          // 「一食堂二楼经济窗口」
  cost: { money?: number; timeMin?: number };
  nutrition?: MealNutrition;              // v1.7：一餐的结构标签，仅餐饮类
  pros: string[];                         // 优势
  cons: string[];                         // 代价
  impacts: Impact[];                      // 可能影响（决策模拟，见 §4.4）
  evidences: Evidence[];                  // 各 Agent 依据（「为什么」展开渲染）
}

/**
 * v1.7：结构标签，0/1/2 三级。
 * 刻意不引入 kcal——食堂菜品没有可信的热量数据来源，
 * 编一个精确到个位的数字写进产品，比不写更糟。
 */
interface MealNutrition {
  veg: 0 | 1 | 2;                         // 0 没有蔬菜 / 1 偏少 / 2 到位
  protein: 0 | 1 | 2;                     // 0 偏少 / 1 够 / 2 充足
  oil: 0 | 1 | 2;                         // 0 偏重 / 1 适中 / 2 偏轻
}

interface Impact {
  horizon: 'short' | 'long';
  text: string;                           // 「明早前两节课注意力下降风险高」
  agentId: AgentId;                       // 预测来源
}
```

## 3. 冲突卡 Schema

```ts
interface ConflictCard {
  id: string;
  topic: string;
  level: 'L1' | 'L2';                     // L1=已被编排器自动合并（仅记录）；L2=需用户裁决
  planA: ConflictPlan;
  planB: ConflictPlan;
  resolvedBy?: 'user' | 'orchestrator';
  preset?: boolean;                       // 是否按历史偏好预填（裁决一次，不重复打扰）
  presetChoice?: 'A' | 'B';               // 上次选的方案（v1.6）：只有布尔标记而不高亮，等于骗人
}

interface ConflictPlan extends OptionCard {
  agentId: AgentId;                       // 主张方
}
```

## 4. 报告 = 区块拼装

```ts
interface Report {
  type: 'morning' | 'noon' | 'evening' | 'exam-day' | 'exam-week' | 'exam-done';
  generatedAt: Date;
  blocks: ReportBlock[];                  // 配方组装，见下
}

type ReportBlock =
  | { kind: 'overview'; items: OverviewItem[] }          // 今日概览 / 上午回顾
  | { kind: 'suggestionGroup'; suggestion: Suggestion }  // 一组选项卡
  | { kind: 'conflict'; conflict: ConflictCard }         // 冲突卡
  | { kind: 'warning'; text: string; agentId: AgentId }  // 红线警告
  | { kind: 'recap'; stats: RecapStats }                 // 晚间复盘 / 考后小结
  | { kind: 'preview'; items: string[] }                 // 明日预告
  | { kind: 'checklist'; title: string; items: string[] }; // 清单卡（v1.2：考试日物品清单）

// 报告配方：砍功能 = 改这里，不改渲染代码
const RECIPES: Record<Report['type'], BlockKind[]> = {
  morning: ['overview', 'suggestionGroup', 'warning'],
  noon: ['overview', 'suggestionGroup', 'conflict', 'warning'],
  evening: ['recap', 'suggestionGroup', 'preview', 'conflict'],
  'exam-day': ['overview', 'warning', 'suggestionGroup', 'checklist'], // 生存模式（v1.2）
  'exam-week': ['overview', 'warning', 'suggestionGroup', 'conflict', 'recap'], // warning 于 v1.5 补入
  'exam-done': ['overview', 'warning', 'recap', 'suggestionGroup'], // 考后 2–6h（v1.4）
};
```

### 4.1 生存模式注入（v1.2 新增）

生存模式**不改 Agent，也不新增 Agent**：编排器在 `mode === 'exam'` 时额外跑一次考试域，把产出当作一个合成 `AgentResult` 推进结果数组，之后所有下游（富化 / 仲裁 / 拼装）完全不感知差异。因此关掉生存模式 = 删掉一次函数调用，普通链路零风险。

```ts
// 判定（src/lib/examMode.ts）
const EXAM_LEAD_DAYS = 7;                 // 考前 7 天进入 exam
const EXAM_DAY_GRACE_MS = 6 * 3600_000;   // 考试结束时刻后仍算「考试日」6 小时，用于出当日清单
interface ExamWindow { mode: Mode; daysToExam: number | null; isExamDay: boolean;
                       nextExam: ExamItem | null; upcoming: ExamItem[] }

// 权重（src/orchestrator/exam.ts）：写进事件流供 B 的动画展示
const EXAM_WEIGHT = { academic: 1.2, life: 1.0, health: 1.3, schedule: 1.4 };
// 合成结果的 finding id 约定（B 侧渲染与文案依赖这几个 id，改名视为契约变更）
//   exam:title       考试标题（checklist 卡标题取它）
//   exam:countdown   倒计时一句话（概览「倒计时」行）
//   exam:blocks      复习窗口描述（概览「复习窗口」行）
//   exam:lead        daysToExam <= 3 时的 warning
//   exam:sleep-debt  近 7 天平均睡眠 < 6.5h 时的 warning
// 复习建议的 topic 固定为「<考试名> 复习」，选项 mastery 越高越偏「刷题」而不是「看书」
```

`Report.type` 与实际触发时段解耦：`mode === 'exam'` 时任何 trigger 都落到 `exam-day` / `exam-week`，标题相应变成「考试日报告」/「冲刺报告」。逃生开关是 `localStorage['xiaoshan:force-normal'] === '1'`（设置页「强制关闭生存模式」），用于路演时在普通版与冲刺版两种形态间切换。

### 4.2 考后小结（v1.4 新增）

一场考试在 `[开考 + 2h, 开考 + 6h]` 之间时，报告切换为 `exam-done`（标题「考后小结」），优先级高于 `exam-day`/`exam-week`：

```ts
EXAM_DONE_AFTER_MS  = 120 * 60_000   // 开考后 2h 之后才算「已考完」
EXAM_DONE_WINDOW_MS =   6 * 3600_000 // 6h 之后回到正常模式
// 合成的 finding（agentId 记在各自的 evidences 里）
//   exam:done           「<考试名> HH:MM 开考，已结束 N 小时」+ 掌握度自评
//   exam:sleep-night    昨晚睡了多久（没有记录就直说没有）
//   exam:review         本周这个主题被点了 N 次「做了」
//   exam:next           下一场考试倒计时，没有就说没有
// 建议 topic 固定为「考完这一晚」，priority 2；`force-normal` 同样能关掉它
```

### 4.3 遵从度回流（v1.4 新增，A8）

编排末尾会对建议做一次**降级回流**，规则与实现都在 `src/orchestrator/compliance.ts`：

```ts
MISSES_BEFORE_DOWNGRADE = 2   // 同一 topic 连续 2 天标「没做」即触发
// 同一天多次点击只取最后一次；priority 最大是 3，已经是 3 的不再降
// 触发时发出一条 merge:applied：「遵从度回流：<topic>（连续 N 次没做，1 → 2）」
// 恢复条件：最近一天标了「做了」，连续计数归零，下次报告自动回到原优先级
```

周报（`recap`）新增一项 **本周建议执行率**：最近 7 天 `做了 / 总点击`，一次都没点过时显示「—（还没点过「做了 / 没做」）」，**不拿示例数据编数字**。

### 4.4 「今晚的空档」L2 冲突（v1.6 新增）

健康与日程对**同一段时间**提出相反主张时，不合并、不替用户决定，生成一张 L2 冲突卡（`arbitrateClaims` 要求同 topic 至少两方主张）。当前唯一规则：

| | 健康 Agent | 日程 Agent |
|---|---|---|
| topic | `今晚的空档` | `今晚的空档` |
| side | `health` | `study` |
| 触发 | 近 3 天平均 < 6h **且** 今晚 18:00 后有 ≥2h 空档 | 48h 内有考试/DDL **且** 同一空档存在 |
| 主张 | 22:00 收工、23:00 睡、明早按课表反推的时间起床 | 18:00–23:00 整块留给最近的考试/DDL |
| 代价 | 今晚复习整块少 N 分钟（实算） | 昨晚只睡 X 小时、近 3 天平均 Y（实算） |

两条实现约束：
- **时间窗一律裁到 18:00–23:00**。没课的日子 `tonightFreeBlock()` 返回的是从早上 07:00 开始的整块，原样展示会出现「今晚 07:00 开始复习」这种明显不对的文案。
- **数字全部现算**，不写死「连续第 4 天没睡够」之类按天数会漂移的描述。
- 用户裁决后写 `preferences.conflictChoices[topic]`，下次同 topic 冲突预填并**高亮**上次的选择（`presetChoice`），仍可一键切换。

### 4.5 「今天的午饭」L2 冲突（v1.7 新增）

省钱和吃好是同一顿饭上的两件事，各自都成立，所以显性化成一张 L2 卡，而不是让 Agent 替用户定。

| | 生活 Agent | 健康 Agent |
|---|---|---|
| topic | `今天的午饭` | `今天的午饭` |
| side | `saving` | `balanced` |
| 触发 | 午餐时段 **且** 日均餐标 < ¥30 **且** 经济窗口带结构标签 | 午餐时段 **且** 近 3 天平均 < 6.5h **且** 轻食窗口带结构标签 |
| 主张 | 一食堂 ¥8，比轻食省 7 元（一个月约 210 元） | 桂香园 ¥15，蔬菜蛋白到位 |
| 代价 | 下午三四点容易饿、连吃几天下午没劲 | 这顿比日均餐标多 ¥N（实算，不超预算时改为「贵一点」） |

三条口径：
- **¥30 门槛是有意的**：预算宽裕时这顿的差价不痛不痒，天天弹「省 7 元还是吃好点」只会变成噪音。
- **健康侧只有缺觉时才提**：理由是「欠觉 → 饭后更困」的常识推论，不是营养学结论；睡够的日子不打扰。
- **结构标签不参与打分排序**：`nutritionScore()` 只做展示与横向比较，不是营养评分，也不进仲裁权重。

结构标签的展示规则：卡片上「这一餐 没有蔬菜 · 蛋白够 · 油偏重 · 加一份青菜，通常多花 2–3 元」——**三级标签 + 一条不改选择也能改的小动作**，比一个精确到个位的热量值更可能被照做。冲突卡（`PlanView`）与选项卡（`OptionCardView`）渲染同一行，避免两处口径不一。


## 5. 数据源 Adapter 接口

```ts
interface DataSourceAdapter {
  id: string;                       // 'mock-canteen' | 'mock-notice' | 'jwgl' …
  provides: string[];               // 提供的数据类型
  fetch(type: string, ctx: AgentContext): Promise<RawItem[]>;
}
// mock 与真实教务系统实现同一接口，切换只改注册表
```

## 6. 编排事件流（UI 只订阅，不反向依赖）

```ts
// 编排动画 UI 监听此事件流渲染，不需要知道引擎内部任何实现
type OrchestratorEvent =
  | { type: 'run:start'; trigger: string }                     // 'noon-report' | 'user-ask'
  | { type: 'agent:start'; agentId: AgentId }
  | { type: 'agent:done'; agentId: AgentId; result: AgentResult }
  | { type: 'merge:applied'; text: string }                    // L1 自动合并结果
  | { type: 'conflict:detected'; conflict: ConflictCard }      // L2 弹出冲突卡
  | { type: 'report:composed'; report: Report };
```

## 7. 目录结构建议

```
src/
  agents/               # 每个 Agent 一个文件，实现 AgentModule
    registry.ts         # 注册表（新增 Agent = 这里加一行）
    academic.ts  life.ts  health.ts  schedule.ts
  orchestrator/         # 总控编排器 + 冲突仲裁 + 事件流
    index.ts  arbiter.ts  events.ts
  data/
    adapters/           # mock 与真实数据源，同一接口
    store/              # IndexedDB 封装 + 偏好 / 遵从度
  ui/
    reports/            # 区块渲染器（每种 block kind 一个组件）
    cards/              # OptionCard / ConflictCard 组件
    animation/          # 订阅事件流的编排动画
  mock-orchestrator.ts  # B 专用：固定输出一份午间报告 JSON，驱动 UI 开发
```

## 8. 双人开发约定

- A 负责 `orchestrator/` + `agents/` + `data/`；B 负责 `ui/`
- B 开发一律用 `mock-orchestrator.ts`（预置一份完整的午间报告 JSON），不依赖 A 的进度
- 契约文件改动 = 必须双方确认，commit message 用 `docs(contract): …`

---

## 9. 变更记录

- **v1.1**（2026-10-21，主体架构落地时同步）：`AgentResult` 增加两个可选扩展字段——`suggestions`（Agent 直接产出的结构化建议草案）与 `conflictClaims`（对某时段/资源的方案主张，由仲裁器配对成 L2 冲突卡）；`Suggestion` 增加 `slot` 字段标记所属报告时段（morning/noon/evening）。代码唯一实现：`src/types/contract.ts`。
- **v1.2**（2026-10-22，生存模式与信息流落地时同步）：
  - `ReportBlock` 增加第七种区块 `{ kind: 'checklist'; title: string; items: string[] }`，用于考试日物品清单；新增渲染器 `src/ui/reports/ChecklistBlock.tsx`
  - `RECIPES` 补齐 `exam-day` / `exam-week` 两条配方（v1.1 时这两条只有类型、无实现路径，属**死代码**）；同时把 `noon` 配方补上代码里早已存在的 `warning`
  - 新增 §4.1 生存模式注入约定：`mode` 判定阈值（7 天 / 6 小时 grace）、`EXAM_WEIGHT` 权重表、合成 finding 的 id 集合（`exam:title` 等五个）
  - 契约层原本就预留了 `Mode`、`AgentContext.mode`、`ExamItem.mastery`、`AgentModule.defaultWeight`，本次只是把它们**接上实现**，未改类型定义本身
- **v1.3**（2026-10-23，周历可编辑落地时同步）：
  - `OverviewItem` 增加可选字段 `link?: string`：概览里的某一行可以指向站内路由（当前只有「今日课程」用它，值形如 `/week?dow=3`）
  - `OverviewBlock` 在有 `link` 时渲染成 `react-router` 的 `Link`（虚线下划线 + 箭头），无 `link` 时保持纯文本，**其他概览行不受影响**
  - 「今日课程」的跳转目标由 `compose.ts` 的 `buildOverview` 按 `dayOfWeek(ctx.now)` 生成；周历页读 `?dow=` 参数决定落在哪一天并给该列加高亮环
  - 类型仍是可选的，A 侧不填也不会破坏渲染——B 侧可独立回滚
- **v1.4**（2026-10-23，考后小结与遵从度回流落地时同步）：
  - `Report['type']` 增加第六种 `'exam-done'`，配方 `['overview','warning','recap','suggestionGroup']`，`SLOT_OF` 归 `evening`；`REPORT_TITLE` 加「考后小结」
  - 新增 §4.2 考后小结：`EXAM_DONE_AFTER_MS`（2h）/ `EXAM_DONE_WINDOW_MS`（6h）与四个合成 finding（`exam:done` 等），优先级高于 exam-day/exam-week
  - 新增 §4.3 遵从度回流：`MISSES_BEFORE_DOWNGRADE = 2`、同日去重、降级只降一级且最多到 3、恢复条件是一次「做了」
  - `recap` 新增「本周建议执行率」；无数据时显示占位而不是编数字
- **v1.5**（2026-10-25，健康口径与一周尺度指标落地时同步）：
  - **睡眠口径**：`lastNightSleep(logs, now)` 只认「昨天那一条」；`avgSleepHours(logs, lastN, now)` 按日历窗口统计且**可返回 `null`**；新增 `wakePlanOf(now)`（按次日最早一节课反推起床时间）与 `hoursIfSleepNow(now, wakeMin)`（自动跨午夜）。调用方拿到 `null` 必须写「—（尚未录入）」，不得回退到健康基线
  - **一周尺度**：新增 `sleepDebt()`（每晚按 `SLEEP_NEED_HOURS = 7.5` 计缺口，同时返回覆盖晚数）、`bedtimeRegularity()`（入睡时刻标准差，凌晨入睡统一 +1440 后计算）、`weekOverWeek()`（本周 7 晚 vs 上周 7 晚，两边都有数才给 `delta`）
  - 健康 Agent 新增三条 finding：`health:sleep-load`（fact，一句话讲清债 / 波动 / 同比）、`health:sleep-debt-warn`（≥6h 才报）、`health:sleep-irregular`（标准差 ≥90 分钟才报）
  - `recap` 新增「睡眠债」一行，与「昨晚睡眠」「近 7 天平均」并列，口径各自写明
  - `RECIPES['exam-week']` 补上 `warning`：此前冲刺报告只在概览里写「N 项需留意」却没有任何一处能读到具体是哪几项
  - `compose` 的警告卡归属改为「先看证据、再看它落在哪个 Agent 的结果里」：此前无证据的警告一律显示成「日程 Agent」，会张冠李戴
- **v1.6**（2026-10-25，健康 × 日程 L2 冲突卡落地时同步）：
  - `ConflictCard` 增加 `presetChoice?: 'A' | 'B'`。此前只有布尔 `preset`：卡上挂着「已按你上次的选择预填」，两个按钮却都是未选状态——说法与界面不一致，等于骗人
  - 新增 §4.4「今晚的空档」L2 冲突的触发口径：健康侧要求「近 3 天平均 <6h **且** 今晚 18:00 后有 ≥2h 可支配空档」，日程侧要求「48h 内有 DDL **且** 同一空档存在」，两侧同 topic 由仲裁器配对
  - 两边的「代价」一律用真实数据算（少复习多少分钟、昨晚睡几小时、近 3 天平均、睡债从多少降到多少），不再写死「睡眠连续第 4 天」这类可能对不上的话
  - 「今晚」的时间窗统一裁到 18:00–23:00：没课的日子 `tonightFreeBlock` 会返回从早上 07:00 开始的整块，原样展示会写出「今晚 07:00 开始复习」
- **v1.7**（2026-10-25，饮食结构标签 + 预算×吃好 L2 落地时同步）：
  - `OptionCard` 增加 `nutrition?: MealNutrition`（`veg / protein / oil` 各 0–2 三级）。**不引入 kcal**：食堂菜品没有可信的热量来源，编数字比不写更糟；也不碰体重/BMI 评价
  - 食堂窗口数据（`RawItem.payload.nutrition`）补齐四个窗口的结构标签；数据源没标时 `nutritionOf()` 返回 `undefined`，卡上就不显示这一行——**不猜**
  - 新增 §4.5「今天的午饭」L2 冲突的触发口径与三条门槛（日均餐标 <¥30、健康侧仅缺觉时提、结构标签不参与排序）
  - 选项卡与冲突卡渲染同一行结构文案（`nutritionLabel()` / `nutritionTip()` 放在 `src/lib/nutrition.ts`），避免两处口径不一
  - 冲突卡两列改为 `min-w-0 flex-1 basis-0`：此前两列宽度随内容伸缩，一边长一边短，看着像两个不相关的卡

