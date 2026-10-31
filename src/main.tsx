import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { initTheme } from '@/lib/theme'

// 暗色模式：跟随系统 prefers-color-scheme，可用设置页手动覆盖
initTheme()

// PWA：注册 Service Worker（离线可用的根基）
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
