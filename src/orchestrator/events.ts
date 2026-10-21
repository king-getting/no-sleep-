import type { OrchestratorEvent } from '@/types/contract';

type Listener = (event: OrchestratorEvent) => void;

/**
 * 编排事件流总线（契约 §6）
 * UI 只订阅此事件流渲染编排动画，永远不 import 引擎内部。
 * 保留本轮运行的历史事件，晚订阅的 UI 也能回放完整过程。
 */
class OrchestratorEventBus {
  private listeners = new Set<Listener>();
  private history: OrchestratorEvent[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(event: OrchestratorEvent): void {
    // run:start 开启新一轮，清空上一轮历史
    this.history = event.type === 'run:start' ? [event] : [...this.history, event];
    for (const fn of this.listeners) fn(event);
  }

  getHistory(): OrchestratorEvent[] {
    return this.history;
  }
}

export const orchestratorEvents = new OrchestratorEventBus();
