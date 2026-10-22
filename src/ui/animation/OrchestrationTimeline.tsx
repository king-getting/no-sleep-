import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, GitMerge, Loader2, Mountain, Scale } from 'lucide-react';
import { orchestratorEvents } from '@/orchestrator/events';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { AgentId, ConflictCard, OrchestratorEvent } from '@/types/contract';

const TRIGGER_LABEL: Record<string, string> = {
  'morning-report': '晨间报告触发',
  'noon-report': '午间报告触发',
  'evening-report': '晚间报告触发',
  'user-ask': '用户提问触发',
};

const AGENT_IDS: AgentId[] = ['academic', 'life', 'health', 'schedule'];

/** 冲突 topic 在契约里是稳定 id（也是偏好预填的键），展示层才转成中文 */
const TOPIC_LABEL: Record<string, string> = {
  'tonight-slot': '今晚几点睡',
  lunch: '午饭吃什么',
  'afternoon-gap': '午后空档',
};

const STEPS = ['拆解任务', '并行执行', '汇总决策'];

type AgentState = {
  status: 'waiting' | 'running' | 'done';
  findings: number;
  extra: number;
};

/**
 * 编排动画（契约 §6 / 任务 B8）：
 * 订阅编排事件流，渲染「总控拆任务 → 4 个 Agent 并行 → 冲突/合并 → 汇总」全过程。
 * 只认识事件流，对引擎实现零依赖——A 侧换实现，这里不用改。
 */
export function OrchestrationTimeline() {
  const [events, setEvents] = useState<OrchestratorEvent[]>(() => orchestratorEvents.getHistory());

  useEffect(() => {
    return orchestratorEvents.subscribe(() => {
      setEvents([...orchestratorEvents.getHistory()]);
    });
  }, []);

  const view = useMemo(() => {
    const agentStates = new Map<AgentId, AgentState>(
      AGENT_IDS.map((id) => [id, { status: 'waiting', findings: 0, extra: 0 }]),
    );
    const conflicts: ConflictCard[] = [];
    const merges: string[] = [];
    let trigger: string | null = null;
    let composed = false;
    let running: AgentId | null = null;

    for (const e of events) {
      switch (e.type) {
        case 'run:start':
          trigger = e.trigger;
          break;
        case 'agent:start':
          agentStates.set(e.agentId, { status: 'running', findings: 0, extra: 0 });
          running = e.agentId;
          break;
        case 'agent:done':
          agentStates.set(e.agentId, {
            status: 'done',
            findings: e.result.findings.length,
            extra:
              (e.result.suggestions?.length ?? 0) + (e.result.conflictClaims?.length ?? 0),
          });
          if (running === e.agentId) running = null;
          break;
        case 'conflict:detected':
          conflicts.push(e.conflict);
          break;
        case 'merge:applied':
          merges.push(e.text);
          break;
        case 'report:composed':
          composed = true;
          break;
      }
    }

    const doneCount = AGENT_IDS.filter((id) => agentStates.get(id)?.status === 'done').length;
    const isRunning = events.length > 0 && !composed;
    const step = composed ? 3 : events.some((e) => e.type === 'agent:start') ? 1 : 0;

    return { agentStates, conflicts, merges, trigger, composed, isRunning, doneCount, step };
  }, [events]);

  return (
    <aside className="rounded-2xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          编排过程
          {view.isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </h3>
        {events.length > 0 && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              view.composed
                ? 'bg-secondary text-secondary-foreground'
                : 'bg-primary/10 text-primary',
            )}
          >
            {view.composed ? `${view.doneCount}/4 已汇总` : `${view.doneCount}/4 执行中`}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">触发一张报告，看 4 个 Agent 如何协同。</p>
      ) : (
        <>
          {/* 三步流程条：8 秒读懂「在干什么、走到哪一步」 */}
          <div className="mt-3 flex items-center gap-1 text-[11px]">
            {STEPS.map((label, i) => (
              <div key={label} className="flex min-w-0 flex-1 items-center gap-1">
                <span
                  className={cn(
                    'truncate rounded-md px-1.5 py-0.5 transition-colors duration-500',
                    i < view.step && 'bg-primary/10 text-primary',
                    i === view.step && 'bg-primary text-primary-foreground',
                    i > view.step && 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && (
                  <span
                    className={cn(
                      'h-px flex-1 transition-colors duration-500',
                      i < view.step ? 'bg-primary/40' : 'bg-border',
                    )}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-0.5">
            {/* 总控节点 */}
            <Row
              icon={<Mountain className="h-3.5 w-3.5" />}
              tone="primary"
              title="总控编排器"
              detail={view.trigger ? `${TRIGGER_LABEL[view.trigger] ?? view.trigger} · 拆解任务` : '拆解任务'}
              animate
              rail
            />

            {/* 4 个 Agent 并行 */}
            {AGENT_IDS.map((id) => {
              const meta = AGENT_META[id];
              const state = view.agentStates.get(id)!;
              const inConflict = view.conflicts.some(
                (c) => c.planA.agentId === id || c.planB.agentId === id,
              );
              return (
                <Row
                  key={id}
                  icon={<meta.icon className="h-3.5 w-3.5" />}
                  tone={state.status === 'waiting' ? 'idle' : 'agent'}
                  colorClass={meta.color}
                  title={`${meta.name} Agent`}
                  detail={
                    state.status === 'waiting'
                      ? '等待分派'
                      : state.status === 'running'
                        ? '正在检索本地数据…'
                        : `完成 · ${state.findings} 条发现${
                            state.extra > 0 ? ` / ${state.extra} 条建议` : ''
                          }`
                  }
                  badge={inConflict ? '冲突' : undefined}
                  pulse={state.status === 'running'}
                  animate={state.status !== 'waiting'}
                  rail
                />
              );
            })}

            {/* 冲突裁决节点 */}
            {view.conflicts.map((c) => (
              <Row
                key={c.id}
                icon={<Scale className="h-3.5 w-3.5" />}
                tone="warn"
                title={`冲突待裁决 · ${TOPIC_LABEL[c.topic] ?? c.topic}`}
                detail={`${AGENT_META[c.planA.agentId].name} vs ${AGENT_META[c.planB.agentId].name}`}
                animate
                rail={false}
              />
            ))}

            {/* L1 自动合并节点 */}
            {view.merges.map((text, i) => (
              <Row
                key={`merge-${i}`}
                icon={<GitMerge className="h-3.5 w-3.5" />}
                tone="agent"
                title="L1 自动合并"
                detail={text}
                animate
                rail={false}
              />
            ))}

            {/* 汇总节点 */}
            {view.composed && (
              <Row
                icon={<Check className="h-3.5 w-3.5" />}
                tone="primary"
                title="报告已生成"
                detail="总控汇总所有结果，落成可读报告"
                animate
                rail={false}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

type RowTone = 'primary' | 'agent' | 'warn' | 'idle';

const ROW_STYLE: Record<RowTone, { node: string; ring: string }> = {
  primary: { node: 'bg-primary text-primary-foreground border-primary', ring: 'bg-primary/20' },
  agent: {
    node: 'bg-secondary text-secondary-foreground border-border',
    ring: 'bg-secondary',
  },
  warn: {
    node: 'bg-amber-100 text-amber-700 border-amber-300',
    ring: 'bg-amber-200',
  },
  idle: { node: 'bg-muted text-muted-foreground border-border', ring: 'bg-muted' },
};

function Row({
  icon,
  tone,
  colorClass,
  title,
  detail,
  badge,
  pulse,
  animate,
  rail,
}: {
  icon: ReactNode;
  tone: RowTone;
  colorClass?: string;
  title: string;
  detail: string;
  badge?: string;
  pulse?: boolean;
  animate?: boolean;
  rail?: boolean;
}) {
  const style = ROW_STYLE[tone];
  return (
    <div
      className={cn(
        'relative flex gap-3 pb-3',
        animate && 'animate-in fade-in slide-in-from-left-1 duration-300',
      )}
    >
      {rail && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" aria-hidden />}
      <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center">
        {pulse && (
          <span
            className={cn('absolute inset-0 animate-ping rounded-full opacity-60', style.ring)}
            aria-hidden
          />
        )}
        <span
          className={cn(
            'relative flex h-7 w-7 items-center justify-center rounded-full border',
            style.node,
          )}
        >
          {icon}
        </span>
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-1.5">
          <span className={cn('truncate text-[13px] font-medium', colorClass)}>{title}</span>
          {badge && (
            <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-700">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}
