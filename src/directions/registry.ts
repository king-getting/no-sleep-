import { academicDirection } from './academic';
import { healthDirection } from './health';
import { lifeDirection } from './life';
import { scheduleDirection } from './schedule';
import { restoreDirectionSettings } from './restore';
import type { DirectionId, DirectionModule } from '@/types/contract';

/**
 * 方向 注册表：新增 方向 = 加一个文件 + 这里注册一行（契约 §1）。
 * 设置里的「按 方向 启停」直接改 enabled 字段即可。
 */
export const directionRegistry: DirectionModule[] = [academicDirection, lifeDirection, healthDirection, scheduleDirection];

// 模块加载即恢复设置页的启停与权重：必须早于任何组件渲染，
// 否则首屏那份报告会用默认设置生成（见 restore.ts 的说明）
restoreDirectionSettings(directionRegistry);

export function getEnabledDirections(): DirectionModule[] {
  return directionRegistry.filter((a) => a.enabled);
}

export function getDirection(id: DirectionId): DirectionModule | undefined {
  return directionRegistry.find((a) => a.id === id);
}
