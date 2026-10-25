import { readAgentEnabled, readAgentWeights } from '@/data/store/boot';
import type { AgentModule } from '@/types/contract';

/**
 * 把设置页存下来的启停与权重应用回注册表（模块级单例）。
 *
 * 为什么必须在模块加载时做，而不是放在 App 的 useEffect 里：
 * React 的 effect 是「子组件先、父组件后」，Home 的首次报告早于 App 的 effect 执行，
 * 于是**页面打开后的第一份报告总是用默认设置生成的**——关掉的 Agent 照样出现、
 * 调过的权重照样不生效，直到用户手动再点一次报告。
 */
export function restoreAgentSettings(agents: AgentModule[]): void {
  if (typeof localStorage === 'undefined') return;
  const enabled = readAgentEnabled();
  const weights = readAgentWeights();
  for (const agent of agents) {
    if (enabled[agent.id] !== undefined) agent.enabled = enabled[agent.id];
    if (weights[agent.id] !== undefined) agent.defaultWeight = weights[agent.id];
  }
}
