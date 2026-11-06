import { readDirectionEnabled, readDirectionWeights } from '@/data/store/boot';
import type { DirectionModule } from '@/types/contract';

/**
 * 把设置页存下来的启停与权重应用回注册表（模块级单例）。
 *
 * 为什么必须在模块加载时做，而不是放在 App 的 useEffect 里：
 * React 的 effect 是「子组件先、父组件后」，Home 的首次报告早于 App 的 effect 执行，
 * 于是**页面打开后的第一份报告总是用默认设置生成的**——关掉的 方向 照样出现、
 * 调过的权重照样不生效，直到用户手动再点一次报告。
 */
export function restoreDirectionSettings(directions: DirectionModule[]): void {
  if (typeof localStorage === 'undefined') return;
  const enabled = readDirectionEnabled();
  const weights = readDirectionWeights();
  for (const direction of directions) {
    if (enabled[direction.id] !== undefined) direction.enabled = enabled[direction.id];
    if (weights[direction.id] !== undefined) direction.defaultWeight = weights[direction.id];
  }
}
