import { academicAgent } from './academic';
import { healthAgent } from './health';
import { lifeAgent } from './life';
import { scheduleAgent } from './schedule';
import type { AgentId, AgentModule } from '@/types/contract';

/**
 * Agent 注册表：新增 Agent = 加一个文件 + 这里注册一行（契约 §1）。
 * 设置里的「按 Agent 启停」直接改 enabled 字段即可。
 */
export const agentRegistry: AgentModule[] = [academicAgent, lifeAgent, healthAgent, scheduleAgent];

export function getEnabledAgents(): AgentModule[] {
  return agentRegistry.filter((a) => a.enabled);
}

export function getAgent(id: AgentId): AgentModule | undefined {
  return agentRegistry.find((a) => a.id === id);
}
