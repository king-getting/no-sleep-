# 小山 · CCUNER 的本地小助手

专属于华师（CCNU）学生的本地优先 AI 校园助手：**数据不出设备，决策过程看得见。**

> 校园黑客松参赛项目 🏔️🌼

## 为什么是小山

- **本校专属**：只做华师（桂子山 / 南湖），信息按身份过滤，山民秒懂
- **本地优先**：课表、日程、健康数据只存在你自己的设备上，断网照样用
- **可解释多智能体**：教务 / 生活 / 健康 / 日程 4 个专职 Agent + 总控编排器，每条建议都给出依据
- **给选项，不替人决定**：所有建议以选项卡呈现，标注成本与可能影响，用户拍板，助手记住偏好

## 文档导航

- [项目设计文档](docs/CCUNER校园助手-项目设计.md) —— 产品定位、功能详设、多智能体架构与冲突仲裁、考试周生存模式、onboarding、隐私设计、品牌视觉、路演脚本、分工与协同规范

## 技术栈

React + TypeScript + Vite · Tailwind CSS + shadcn/ui · Dexie/IndexedDB（本地数据层） · vite-plugin-pwa（离线可用） · Vercel 部署（计划）

## 快速开始

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # 产物 dist/（PWA 离线包）
```

首屏自动唤出「午间报告」演示：左侧是总控编排器 → 4 个专职 Agent 的实时编排事件流，右侧是报告卡（选项卡 / 冲突卡 / 依据展开）。顶部按钮可手动唤出晨间（7:30）/ 午间（11:30）/ 晚间（21:30）任意时段报告。

## 架构

```
src/
  types/contract.ts   # Agent 契约类型的唯一代码实现（对应 docs/agent-contract.md）
  agents/             # 教务 / 生活 / 健康 / 日程 4 个专职 Agent + 注册表
  orchestrator/       # 总控编排器：事件流 events.ts · 冲突仲裁 arbiter.ts · 配方 recipes.ts · 组装 compose.ts
  data/
    adapters/         # 数据源 adapter 注册表（mock 与真实源同一接口，切换零成本）
    store/            # Dexie/IndexedDB：画像、偏好、睡眠、点选与遵从度记录
    mock/             # 示例数据集中管理（带「示例数据」标签，可一键清除）
  ui/
    reports/          # 报告区块渲染器（每种 block kind 一个组件）
    cards/            # 选项卡 OptionCard / 冲突卡 ConflictCard
    animation/        # 订阅编排事件流的可视化时间线
  mock-orchestrator.ts # B 侧开发用固定午间报告 JSON
```

## 协同开发

见设计文档 §14。要点：`main` 受保护，`feat/*` / `fix/*` 分支经 PR 合并；约定式提交；mock 数据集中管理，UI 只走 adapter 层与契约 Schema。

## 当前状态

🏗️ 主体架构已落地：契约类型层、编排器 + 冲突仲裁、4 个专职 Agent、本地数据层、三餐报告 UI 与编排动画全链路可运行，进入功能冲刺。
