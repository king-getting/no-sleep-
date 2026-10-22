# 小山 · Agent 输出契约与模块接口（v1.3）

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
  pros: string[];                         // 优势
  cons: string[];                         // 代价
  impacts: Impact[];                      // 可能影响（决策模拟，见 §4.4）
  evidences: Evidence[];                  // 各 Agent 依据（「为什么」展开渲染）
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
}

interface ConflictPlan extends OptionCard {
  agentId: AgentId;                       // 主张方
}
```

## 4. 报告 = 区块拼装

```ts
interface Report {
  type: 'morning' | 'noon' | 'evening' | 'exam-day' | 'exam-week';
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
  'exam-week': ['overview', 'suggestionGroup', 'conflict', 'recap'],
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
