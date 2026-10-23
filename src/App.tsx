import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { Apple, CalendarDays, HeartPulse, LayoutList, ListChecks, Settings2 } from 'lucide-react';
import Home from './pages/Home';
import Feed from './pages/Feed';
import Week from './pages/Week';
import Plan from './pages/Plan';
import Health from './pages/Health';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import { agentRegistry } from '@/agents/registry';
import { bootMode, readAgentEnabled } from '@/data/store/boot';
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
  { to: '/plan', label: '复习', icon: ListChecks },
  { to: '/feed', label: '信息流', icon: Apple },
  { to: '/health', label: '健康', icon: HeartPulse },
  { to: '/settings', label: '设置', icon: Settings2 },
];

export default function App() {
  /** null = 还在判断；true = 需要走建档流程 */
  const [needOnboarding, setNeedOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    // 恢复设置页里改过的 Agent 启停（注册表是模块级单例，持久化只能靠 localStorage）
    const persisted = readAgentEnabled();
    for (const agent of agentRegistry) {
      if (persisted[agent.id] !== undefined) agent.enabled = persisted[agent.id];
    }

    void (async () => {
      if (bootMode() === 'real' && !(await hasProfile())) {
        setNeedOnboarding(true);
        return;
      }
      setNeedOnboarding(false);
    })();
  }, []);

  if (needOnboarding === null) {
    return <p className="p-10 text-center text-sm text-muted-foreground">正在读取本机数据…</p>;
  }

  if (needOnboarding) {
    return (
      <Onboarding
        onDone={() => {
          // 完成后整页重载：Home 的首屏报告逻辑依赖 ensureSeeded() 的时序，重载最省心
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/week" element={<Week />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/health" element={<Health />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Home />} />
      </Routes>

      {/* pb-[env(safe-area-inset-bottom)]：iPhone 无 home 键机型 / 微信 WebView 底部小白条会盖住文字 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
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
    </div>
  );
}
