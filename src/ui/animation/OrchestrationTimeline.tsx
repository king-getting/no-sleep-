import { useEffect, useState } from 'react';
import { GitMerge, Loader2, PlayCircle, Scale, ScrollText } from 'lucide-react';
import { orchestratorEvents } from '@/orchestrator/events';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { OrchestratorEvent } from '@/types/contract';

const TRIGGER_LABEL: Record<string, string> = {
  'morning-report': '晨间报告触发',
  'noon-report': '午间报告触发',
  'evening-report': '晚间报告触发',
  'user-ask': '用户提问触发',
};

/**
 * 编排动画（契约 §6）：订阅编排事件流渲染「总控拆任务 → Agent 并行 → 汇总决策」全过程。
 * 组件只认识事件流，对引擎实现零依赖。
 */
export function OrchestrationTimeline() {
  const [events, setEvents] = useState<OrchestratorEvent[]>(() => orchestratorEvents.getHistory());

  useEffect(() => {
    return orchestratorEvents.subscribe(() => {
      setEvents([...orchestratorEvents.getHistory()]);
    });
  }, []);

  const running = events.length > 0 && events.at(-1)?.type !== 'report:composed';

  return (
    <aside className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        编排过程
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </h3>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">触发一张报告，看 4 个 Agent 如何协同。</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {events.map((e, i) => (
            <li key={i} className="animate-in fade-in slide-in-from-left-2 text-sm duration-300">
              <EventLine event={e} />
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function EventLine({ event }: { event: OrchestratorEvent }) {
  switch (event.type) {
    case 'run:start':
      return (
        <p className="flex items-center gap-2 font-medium">
          <PlayCircle className="h-4 w-4 text-primary" />
          {TRIGGER_LABEL[event.trigger] ?? event.trigger}，总控编排器拆解任务
        </p>
      );
    case 'agent:start': {
      const meta = AGENT_META[event.agentId];
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className={cn('h-2 w-2 animate-pulse rounded-full', meta.bg)} />
          {meta.name} Agent 开始执行…
        </p>
      );
    }
    case 'agent:done': {
      const meta = AGENT_META[event.agentId];
      const n = event.result.findings.length;
      const extra =
        (event.result.suggestions?.length ?? 0) + (event.result.conflictClaims?.length ?? 0);
      return (
        <p className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', meta.bg)} />
          <span className={meta.color}>{meta.name} Agent</span>
          <span className="text-muted-foreground">
            完成：{n} 条发现{extra > 0 ? `，${extra} 条建议/主张` : ''}
          </span>
        </p>
      );
    }
    case 'merge:applied':
      return (
        <p className="flex items-start gap-2 text-muted-foreground">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {event.text}
        </p>
      );
    case 'conflict:detected':
      return (
        <p className="flex items-start gap-2 font-medium text-amber-600">
          <Scale className="mt-0.5 h-4 w-4 shrink-0" />
          检测到真冲突：两方案已摆上桌，等你拍板
        </p>
      );
    case 'report:composed':
      return (
        <p className="flex items-center gap-2 font-medium text-primary">
          <ScrollText className="h-4 w-4" />
          总控汇总完毕，报告已生成
        </p>
      );
  }
}
