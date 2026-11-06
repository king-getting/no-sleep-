import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { Apple, CalendarDays, CalendarRange, Flower2, HeartPulse, LayoutList, ListChecks, Mountain, Settings2, ShieldCheck } from 'lucide-react';
import Home from './pages/Home';
import Feed from './pages/Feed';
import Week from './pages/Week';
import Month from './pages/Month';
import Plan from './pages/Plan';
import Health from './pages/Health';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import Assessment from './pages/Assessment';
import ChatDock from '@/ui/chat/ChatDock';
import { hasProfile } from '@/data/store/profile';

/**
 * 应用外壳（B1 的入口判定 + B2/B7 的路由 + 底部导航）
 *
 * 注意：main.tsx 已经用 <BrowserRouter> 包住了 App，所以这里只用 Routes/Route，
 * 不要重复包 Router。刷新时 Vercel 需要 SPA 回退（见 INTEGRATION.md 的 vercel.json）。
 */

const TABS = [
  { to: '/', label: '报告', icon: LayoutList },
  { to: '/week', label: '周历', icon: CalendarDays },
  { to: '/month', label: '月历', icon: CalendarRange },
  { to: '/plan', label: '任务', icon: ListChecks },
  { to: '/feed', label: '信息流', icon: Apple },
  { to: '/health', label: '健康', icon: HeartPulse },
  { to: '/settings', label: '设置', icon: Settings2 },
];

export default function App() {
  /** null = 还在判断；true = 需要走建档流程 */
  const [needOnboarding, setNeedOnboarding] = useState<boolean | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    // 方向 的启停与权重已在 registry 模块加载时恢复（见 @/directions/restore），
    // 这里不再重复——放在 effect 里会晚于 Home 的首次报告，导致首屏用默认设置生成。

    void (async () => {
      try {
        if (!(await hasProfile())) {
          setNeedOnboarding(true);
          return;
        }
        setNeedOnboarding(false);
      } catch (e) {
        // IndexedDB 打不开（无痕模式 / 隐私策略 / 库版本冲突）时不能无限等待，
        // 否则整站停在这一句，连设置页都进不去。
        console.error('[小山] 启动判定失败：', e);
        setBootError(e instanceof Error ? e.message : String(e));
        setNeedOnboarding(false);
      }
    })();
  }, []);

  if (needOnboarding === null) {
    return <p className="p-10 text-center text-sm text-muted-foreground">正在读取本机数据…</p>;
  }

  if (needOnboarding) {
    return (
      <Onboarding
        onDone={(next) => {
          // 建完档可以直接去做 2 分钟习惯测评；整页跳转，避开种子数据的时序
          window.location.href = next === 'assessment' ? '/assessment' : '/';
        }}
      />
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {bootError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          本机存储没能读出来（{bootError.slice(0, 60)}），当前以空数据继续。
          <button
            type="button"
            className="ml-2 underline underline-offset-2"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
        </div>
      )}
      {/* 桌面端主导航：手机端仍用底部 tab，lg 起收进顶部 header */}
      <header className="sticky top-0 z-20 hidden border-b bg-background/85 backdrop-blur lg:block">
        <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center gap-6 px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2" aria-label="小山首页">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Mountain className="h-4.5 w-4.5" />
              <Flower2 className="absolute -right-1 -top-1 h-3 w-3 text-amber-300" />
            </span>
            <span className="font-serif text-lg font-bold leading-none">小山</span>
            <span className="text-[11px] leading-none text-muted-foreground">CCUNER 的本地小助手</span>
          </NavLink>

          <nav className="flex items-center gap-1">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              本地优先 · 数据不出设备
            </span>
          </span>
        </div>
      </header>


      <div className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/week" element={<Week />} />
          <Route path="/month" element={<Month />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/health" element={<Health />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/assessment" element={<Assessment onDone={() => { window.location.href = '/'; }} />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>

      {/* pb-[env(safe-area-inset-bottom)]：iPhone 无 home 键机型 / 微信 WebView 底部小白条会盖住文字 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* 对话入口：所有页面都能叫出小山，手机端抬到 tab 栏上方 */}
      <ChatDock />
    </div>
  );
}
