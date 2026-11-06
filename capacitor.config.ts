import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 套壳配置
 *
 * webDir 指向上一次 `npm run build` 的产物；`npx cap sync android` 会把它拷进
 * android/app/src/main/assets/public。APK 里跑的就是这份打包结果，离线可用。
 */
const config: CapacitorConfig = {
  appId: 'com.king.xiaoshan',
  appName: '小山',
  webDir: 'dist',
  android: {
    // 全部数据都在本机，没有跨域请求，不需要混合内容
    allowMixedContent: false,
  },
};

export default config;
