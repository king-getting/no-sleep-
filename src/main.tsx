import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import { toast } from 'sonner'
import './index.css'
import App from './App.tsx'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { initTheme } from '@/lib/theme'
import { initPwaInstall } from '@/lib/pwaInstall'
import { maybeAutoBackup } from '@/lib/autobackup'

// 暗色模式：跟随系统 prefers-color-scheme，可用设置页手动覆盖
initTheme()

/**
 * GitHub Pages 把站点放在 /no-sleep-/ 子路径下，路由前缀必须跟着变；
 * Netlify 用相对 base（'./'），此时保持根路径。
 */
const routerBasename = import.meta.env.BASE_URL.startsWith('/')
  ? import.meta.env.BASE_URL.replace(/\/$/, '') || '/'
  : '/'

// 申请持久化存储：浏览器空间紧张时默认会清 IndexedDB，申请后不会被静默回收
void navigator.storage?.persist?.().catch(() => {})

// 安装引导：尽早订阅 beforeinstallprompt，设置页才能显示「安装到桌面」
initPwaInstall()

// 自动备份：打开时一次、每 5 分钟一次、切到后台时一次；内容没变不会写盘
void maybeAutoBackup()
window.setInterval(() => void maybeAutoBackup(), 5 * 60_000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void maybeAutoBackup()
})

// PWA：注册 Service Worker（离线可用的根基）
//
// registerType 是 prompt：新版本装好后先待命，发一条「点此刷新」，
// 而不是让用户对着旧缓存发呆——之前线上的更新就是这么被 Service Worker 吃掉的。
const swRef: { update?: (reloadPage?: boolean) => Promise<void> } = {};
swRef.update = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast('有新版本可用', {
      description: '刷新一下就是最新版，本机数据不受影响。',
      duration: Infinity,
      action: {
        label: '刷新',
        onClick: () => {
          void swRef.update?.(true)
        },
      },
    })
  },
  onOfflineReady() {
    toast('已可离线使用', { description: '断网也能打开，数据都在本机。' })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={routerBasename}>
        <App />
        {/* 全局提示：不挂这个，全项目的 toast() 都不会显示 */}
        <Toaster position="top-center" />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
