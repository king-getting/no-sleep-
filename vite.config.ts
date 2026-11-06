import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  // Netlify 用相对路径；GitHub Pages 部署时由 VITE_BASE 传 '/no-sleep-/'
  base: process.env.VITE_BASE || './',
  // 构建时刻：设置页会显示它，用来确认「打开的是不是最新版本」
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    inspectAttr(),
    react(),
    // PWA：离线可用 + 可安装，支撑「断网演示」（设计文档 §6/§8）
    VitePWA({
      // prompt：新版本先待命并提示刷新，避免用户一直看到 Service Worker 里的旧缓存
      registerType: 'prompt',
      // 注册由 src/main.tsx 的 registerSW 负责，这里不要再自动注入一份
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: '小山 · CCUNER 的本地小助手',
        short_name: '小山',
        description: '专属于华师学生的本地优先 AI 校园助手：数据不出设备，决策过程看得见。',
        theme_color: '#4A6B5C',
        background_color: '#F7F4EC',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    port: 3000,
    watch: {
      // 编辑器/代理写入时会在源码目录留瞬时临时文件，监听器跟上去会 EBUSY 崩掉
      ignored: ['**/*.tmpdir/**', '**/*.tmp', '**/.*.tmp/**'],
    },
  },
  build: {
    // Windows 下 esbuild 处理大 chunk 时会卡在临时文件删除（Access denied），
    // 改用 esnext + terser 绕开该路径；产物仍是现代浏览器可用的 ES2022。
    target: 'esnext',
    minify: 'terser',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
