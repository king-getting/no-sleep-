import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, GitMerge, Loader2, Mountain, RotateCcw, Scale } from 'lucide-react';
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

/* ── 演出节奏（任务 B8 / P0）─────────────────────────────────────
 * 引擎里 4 个 Agent 在几毫秒内全部跑完，事件几乎同帧到达；
 * 直接渲染只能看到一张「终态快照」，协同过程反而是不可见的。
 * 这里把一轮完整事件序列重新铺成约 2.5 秒的时间轴：
 *   拆解任务 → 4 Agent 错峰并行 → 冲突/合并 → 汇总决策
 * 这是**展示用节奏，不是真实耗时**，各 Agent 时长按产出量估算。
 * ──────────────────────────────────────────────────────────── */
const INTRO_MS = 320; // 总控拆解任务的过场
const STAGGER_MS = 100; // 错峰启动，看得出「并行」而不是「排队」
const MIN_AGENT_MS = 380;
const MAX_AGENT_MS = 820;
const PER_ITEM_MS = 55; // 每多一条发现/建议，多跑这么久
const GAP_BEFORE_CONFLICT = 200;
const CONFLICT_STEP = 150;
const MERGE_STEP = 130;
const GAP_BEFORE_COMPOSE = 240;
const TAIL_MS = 260;

type AgentBeat = {
  id: AgentId;
  start: number;
  dur: number;
  findings: number;
  extra: number;
};

type Script = {
  trigger: string | null;
  agents: AgentBeat[];
  conflicts: { at: number; conflict: ConflictCard }[];
  merges: { at: number; text: string }[];
  composeAt: number;
  total: number;
};

type AgentView = {
  status: 'waiting' | 'running' | 'done';
  findings: number;
  extra: number;
  progress: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 把一轮完整事件序列铺成带绝对时间戳的「剧本」 */
function buildScript(events: OrchestratorEvent[]): Script | null {
  const started = events.find((e): e is Extract<OrchestratorEvent, { type: 'run:start' }> =>
    e.type === 'run:start',
  );
  if (!started) return null;

  const finished = new Map<AgentId, { findings: number; extra: number }>();
  const dispatched = new Set<AgentId>();
  const conflicts: ConflictCard[] = [];
  const merges: string[] = [];
  let composed = false;

  for (const e of events) {
    if (e.type === 'agent:start') dispatched.add(e.agentId);
    if (e.type === 'agent:done') {
      dispatched.add(e.agentId);
      finished.set(e.agentId, {
        findings: e.result.findings.length,
        extra: (e.result.suggestions?.length ?? 0) + (e.result.conflictClaims?.length ?? 0),
      });
    }
    if (e.type === 'conflict:detected') conflicts.push(e.conflict);
    if (e.type === 'merge:applied') merges.push(e.text);
    if (e.type === 'report:composed') composed = true;
  }

  // 只演本轮真正被分派的 Agent：设置页关掉某个 Agent 时，面板要跟着变
  const ids = AGENT_IDS.filter((id) => dispatched.has(id));
  if (ids.length === 0) return null;

  const agents: AgentBeat[] = ids.map((id, i) => {
    const d = finished.get(id) ?? { findings: 0, extra: 0 };
    return {
      id,
      start: INTRO_MS + i * STAGGER_MS,
      dur: clamp(
        MIN_AGENT_MS + PER_ITEM_MS * (d.findings + d.extra),
        MIN_AGENT_MS,
        MAX_AGENT_MS,
      ),
      findings: d.findings,
      extra: d.extra,
    };
  });

  const parallelEnd = Math.max(...agents.map((a) => a.start + a.dur));
  const conflictBeats = conflicts.map((conflict, i) => ({
    at: parallelEnd + GAP_BEFORE_CONFLICT + i * CONFLICT_STEP,
    conflict,
  }));
  const mergeBase = conflictBeats.length
    ? conflictBeats[conflictBeats.length - 1].at + CONFLICT_STEP
    : parallelEnd + GAP_BEFORE_CONFLICT;
  const mergeBeats = merges.map((text, i) => ({ at: mergeBase + i * MERGE_STEP, text }));
  const composeAt =
    (mergeBeats.length ? mergeBeats[mergeBeats.length - 1].at : mergeBase) + GAP_BEFORE_COMPOSE;

  return {
    trigger: started.trigger,
    agents,
    conflicts: conflictBeats,
    merges: mergeBeats,
    composeAt,
    total: composed ? composeAt + TAIL_MS : composeAt,
  };
}

/**
 * 编排动画（契约 §6 / 任务 B8）：
 * 订阅编排事件流，渲染「总控拆任务 → 4 个 Agent 并行 → 冲突/合并 → 汇总」全过程。
 * 引擎跑完后把事件重放成 2.5 秒的演出，让「协同过程」真正被看见；
 * 只认识事件流，对引擎实现零依赖——A 侧换实现，这里不用改。
 */
export function OrchestrationTimeline() {
  const [events, setEvents] = useState<OrchestratorEvent[]>(() =>
    orchestratorEvents.getHistory(),
  );
  /** 播放头（ms）；null = 不做演出，直接显示终态 */
  const [now, setNow] = useState<number | null>(null);
  const [replayToken, setReplayToken] = useState(0);

  useEffect(() => {
    return orchestratorEvents.subscribe(() => {
      setEvents([...orchestratorEvents.getHistory()]);
    });
  }, []);

  const script = useMemo(() => buildScript(events), [events]);
  /** 本轮结束的那一个事件对象：本轮内引用稳定，新一轮会换成新对象 */
  const composedEvent = useMemo(
    () => events.find((e) => e.type === 'report:composed') ?? null,
    [events],
  );

  const scriptRef = useRef<Script | null>(script);
  scriptRef.current = script;

  // 开始 / 重播：以「本轮 composed 事件」为触发点；重播按钮用 token 再触发一次
  useEffect(() => {
    const s = scriptRef.current;
    if (!composedEvent || !s) {
      setNow(null);
      return;
    }

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (reduce) {
      setNow(s.total);
      return;
    }

    setNow(0);
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (t: number) => {
      elapsed = Math.min(elapsed + (t - last), s.total);
      last = t;
      setNow(elapsed);
      if (elapsed < s.total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [composedEvent, replayToken]);

  const view = useMemo(() => {
    const agentStates = new Map<AgentId, AgentView>();
    const allConflicts: ConflictCard[] = [];
    const allMerges: string[] = [];
    let trigger: string | null = null;
    let composed = false;
    let anyStarted = false;

    for (const e of events) {
      switch (e.type) {
        case 'run:start':
          trigger = e.trigger;
          break;
        case 'agent:start':
          anyStarted = true;
          break;
        case 'agent:done':
          agentStates.set(e.agentId, {
            status: 'done',
            findings: e.result.findings.length,
            extra:
              (e.result.suggestions?.length ?? 0) + (e.result.conflictClaims?.length ?? 0),
            progress: 1,
          });
          break;
        case 'conflict:detected':
          allConflicts.push(e.conflict);
          break;
        case 'merge:applied':
          allMerges.push(e.text);
          break;
        case 'report:composed':
          composed = true;
          break;
      }
    }

    // 终态模式：本轮还没跑完（或没剧本）时不做演出，避免「假的进行中」
    if (now === null || !script) {
      for (const id of AGENT_IDS) {
        if (!agentStates.has(id)) {
          agentStates.set(id, { status: 'waiting', findings: 0, extra: 0, progress: 0 });
        }
      }
      return {
        trigger,
        agentStates,
        conflicts: allConflicts,
        merges: allMerges,
        composed,
        doneCount: [...agentStates.values()].filter((a) => a.status === 'done').length,
        isRunning: events.length > 0 && !composed,
        step: composed ? 3 : anyStarted ? 1 : 0,
        totalAgents: AGENT_IDS.length,
        animating: false,
      };
    }

    // 剧本模式：按播放头揭示
    const agentViews = new Map<AgentId, AgentView>();
    for (const beat of script.agents) {
      const t = now - beat.start;
      if (t <= 0) {
        agentViews.set(beat.id, { status: 'waiting', findings: 0, extra: 0, progress: 0 });
      } else if (t < beat.dur) {
        agentViews.set(beat.id, {
          status: 'running',
          findings: beat.findings,
          extra: beat.extra,
          progress: t / beat.dur,
        });
      } else {
        agentViews.set(beat.id, {
          status: 'done',
          findings: beat.findings,
          extra: beat.extra,
          progress: 1,
        });
      }
    }

    return {
      trigger: script.trigger,
      agentStates: agentViews,
      conflicts: script.conflicts.filter((c) => now >= c.at).map((c) => c.conflict),
      merges: script.merges.filter((m) => now >= m.at).map((m) => m.text),
      composed: now >= script.composeAt,
      doneCount: script.agents.filter((a) => now >= a.start + a.dur).length,
      isRunning: now < script.total,
      step: now >= script.composeAt ? 3 : script.agents.some((a) => now >= a.start) ? 1 : 0,
      totalAgents: script.agents.length,
      animating: true,
    };
  }, [events, script, now]);

  const replay = useCallback(() => setReplayToken((t) => t + 1), []);
  const canReplay = Boolean(script && composedEvent);

  return (
    <aside className="rounded-2xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          编排过程
          {view.isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </h3>
        <div className="flex items-center gap-1">
          {canReplay && !view.isRunning && (
            <button
              type="button"
              onClick={replay}
              title="重播这次协同"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {events.length > 0 && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                view.composed
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-primary/10 text-primary',
              )}
            >
              {view.composed
                ? `${view.doneCount}/${view.totalAgents} 已汇总`
                : `${view.doneCount}/${view.totalAgents} 执行中`}
            </span>
          )}
        </div>
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
              detail={
                view.trigger ? `${TRIGGER_LABEL[view.trigger] ?? view.trigger} · 拆解任务` : '拆解任务'
              }
              animate
              rail
            />

            {/* 4 个 Agent 并行 */}
            {AGENT_IDS.map((id) => {
              const state = view.agentStates.get(id);
              if (!state) return null;
              const meta = AGENT_META[id];
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
                  progress={state.status === 'running' ? state.progress : undefined}
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
  progress,
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
  /** 0–1：执行中显示一条细进度条，让「并行推进」看得见 */
  progress?: number;
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
        {typeof progress === 'number' && progress < 1 && (
          <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-border" aria-hidden>
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${Math.round(clamp(progress, 0, 1) * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
