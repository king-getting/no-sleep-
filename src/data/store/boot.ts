/**
 * 启动态开关（A6/B1 的存储策略基础）
 *
 * 为什么需要它：ensureSeeded() 首屏会自动灌入示例数据（DEMO_PROFILE, isDemo: true），
 * 读代码可知它没有「空库」状态，因此 onboarding 永远不会被触发。
 * 这里只放一个 localStorage 开关，让「示例体验」与「真实用户」两条路互斥，且不改动 Dexie schema。
 *
 * 无 import：刻意保持零依赖，避免 store/profile.ts → boot → agents → queries → profile 的循环引用。
 */

const BOOT_KEY = 'xiaoshan:boot';
const AGENT_KEY = 'xiaoshan:agents';

export type BootMode = 'demo' | 'real';

/** 当前启动模式；默认 demo（保持现有演示行为不变） */
export function bootMode(): BootMode {
  return localStorage.getItem(BOOT_KEY) === 'real' ? 'real' : 'demo';
}

export function setBootMode(mode: BootMode): void {
  localStorage.setItem(BOOT_KEY, mode);
}

/** 换台设备 / 清缓存后回到示例态，用于路演复位 */
export function resetBootMode(): void {
  localStorage.removeItem(BOOT_KEY);
  localStorage.removeItem(AGENT_KEY);
}

/** 设置页的 Agent 启停持久化（重启后仍然生效） */
export function readAgentEnabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(AGENT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function writeAgentEnabled(map: Record<string, boolean>): void {
  localStorage.setItem(AGENT_KEY, JSON.stringify(map));
}
