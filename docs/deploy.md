# 部署与演示保障（A9）

> **主站（GitHub Pages）**：<https://king-getting.github.io/no-sleep-/>
> push 到 `main` 后由 `.github/workflows/pages.yml` 自动构建发布；构建时注入 `VITE_BASE=/no-sleep-/`，路由 basename 同步跟着变。
>
> **Android 安装包**：`npm run android:apk` 产出 `android/app/build/outputs/apk/debug/app-debug.apk`，需要 JDK 21 + Android SDK 36。
>
> **备用**：Vercel 仍从 GitHub 自动部署（`*.vercel.app` 国内多处被 DNS 投毒 + TLS 重置）；Netlify 镜像因账号额度用完已停更，恢复额度后可继续用 `npx netlify-cli deploy --dir=dist --prod`。
>
> 目标：线上 URL 可访问 + 断网时仍能用。**演示优先用本地或 APK**，不赌会场网络。

## 零、GitHub Pages（当前主站，一次性已配好）

- 仓库 Settings → Pages → Source 选 **GitHub Actions**（已通过 API 设置为 `build_type: workflow`）
- 工作流做的事：`npm ci` → `npm run build`（`VITE_BASE=/no-sleep-/`）→ 复制 `index.html` 为 `404.html`（前端路由兜底）→ 上传 `dist` → 发布
- 站点地址：`https://<用户名>.github.io/<仓库名>/`，本仓库是 `no-sleep-`，所以末尾有一个连字符

## 一、Vercel 部署（约 10 分钟，一次性）

仓库已备好 `vercel.json`（SPA rewrites：任何子路由都回退到 `index.html`，否则 `/feed` 直接刷新会 404）。

1. 用**有仓库权限的 GitHub 账号**登录 <https://vercel.com>（推荐直接 GitHub 授权登录，避免仓库不可见）
2. `Add New… → Project → Import Git Repository`，选 `king-getting/no-sleep-`
3. 框架会被识别为 **Vite**，确认三项：
   - Build Command：`npm run build`（仓库用的是 `package-lock.json`，Vercel 默认走 npm，不要改成 pnpm）
   - Output Directory：`dist`
   - Install Command：留空（默认 `npm install`）
4. 环境变量：**一个都不用填**。本项目不发任何网络请求，没有 API Key（设置页里的 Key 只存 localStorage，当前不接模型）
5. `Deploy`，等 40–90 秒

### 部署后必须验的四条（验收标准）

| 检查 | 期望 |
|---|---|
| 打开线上根路径 | 出现「小山 · CCUNER 的本地小助手」，并有示例数据徽标 |
| 点底部「信息流」再**刷新** | 不 404（说明 rewrites 生效） |
| 点底部「设置」再**刷新** | 不 404 |
| 关上手机 WiFi，再刷新线上地址 | 若之前访问过一次，SW 已缓存，应仍能打开 |

已知风险：`vite.config.ts` 里 `base: './'` 是相对路径。**如果**线上出现「白屏 + 控制台 assets 404」，把 `base` 改成 `'/'` 重新部署即可（本地 `vite preview` 行为不变）。根路径与单段子路由（`/feed`）正常，只有带尾斜杠的路径会踩到，React Router 的链接不带尾斜杠。

## 二、断网演示彩排（已完成，流程留档）

```bash
npm run build          # dev 模式不注册 SW，断网演示必须用构建产物
npm run preview        # 默认 http://127.0.0.1:4173
```

彩排步骤（2026-10-22 实测通过）：

1. 打开首页，等 2–3 秒让 Service Worker 接管（DevTools → Application → Service Workers 显示 activated and running）
2. 依次访问 `/`、`/feed`、`/settings` 各一次（让三个路由都进缓存）
3. **真关掉 preview 进程**（不是切模拟离线），`Invoke-WebRequest` 应报「无法连接到远程服务器」
4. 三个标签页分别刷新 → 全部正常渲染

> 子路由能离线靠 `vite.config.ts` 里原有的 `navigateFallback: 'index.html'`；只要这条还在，PWA 的离线回退就不用额外配置。

## 三、演示与调试开关

| 想展示 | 操作 |
|---|---|
| 普通版报告（无生存模式） | 设置 → 演示旋钮 → 强制关闭生存模式 |
| 冲刺报告（生存模式） | 同上，再点一次关掉 |
| 触发三个时段 | 首页顶部「晨间 7:30 / 午间 11:30 / 晚间 21:30」 |
| 多 方向 协同动画 | 首页左侧时间轴，点任意时段会重放 |
| 关掉某个方向 | 设置 → 方向 启停 → 关「健康 方向」，回首页该区块整段消失 |
| 回到新用户第一屏 | 设置 → 数据 → 清除全部数据 → 刷新 |
| 恢复示例数据 | 设置 → 数据 → 恢复示例数据 |
