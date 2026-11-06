import { useState } from 'react';
import { X } from 'lucide-react';
import type { AgentId, AgentReview } from '@/types/contract';
import { AGENT_META } from '@/ui/agentMeta';
import { cn } from '@/lib/utils';

/**
 * 三个方向的雷达图（学习 / 生活 / 健康）
 *
 * 三条轴固定，顶点离中心越远表示这个选项在该方向上影响越大（impact 0–1）。
 * 具体一利一弊不铺在卡片上，点顶点或右侧标签才弹出来——卡片窄，先把形状给眼睛看。
 */

const AXES: { id: AgentId; angle: number }[] = [
  { id: 'academic', angle: -90 },
  { id: 'life', angle: 30 },
  { id: 'health', angle: 150 },
];

const HEX: Record<AgentId, string> = {
  academic: '#2F4F43',
  life: '#4A6B5C',
  health: '#6B8F7E',
  schedule: '#8FAF9F',
};

const CX = 84;
const CY = 76;
const R = 46;
const MIN_R = 9;

function point(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: CX + Math.cos(rad) * radius, y: CY + Math.sin(rad) * radius };
}

export default function ReviewRadar({ reviews }: { reviews: AgentReview[] }) {
  const [openId, setOpenId] = useState<AgentId | null>(null);
  const byId = new Map(reviews.map((r) => [r.agentId, r]));

  const axes = AXES.map((axis) => {
    const review = byId.get(axis.id);
    const impact = Math.min(1, Math.max(0, review?.impact ?? 0));
    // 开根号：5% 和 90% 的差别肉眼要分得出来，直接线性会把小值压成一个点
    const radius = MIN_R + Math.sqrt(impact) * (R - MIN_R);
    return { ...axis, review, impact, at: point(axis.angle, radius) };
  });

  const open = axes.find((a) => a.id === openId)?.review ?? null;
  const outline = axes.map((a) => `${a.at.x.toFixed(1)},${a.at.y.toFixed(1)}`).join(' ');
  const toggle = (id: AgentId) => setOpenId((prev) => (prev === id ? null : id));

  return (
    <div className="relative mt-1.5" onClick={(e) => e.stopPropagation()}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        三个方向怎么看
      </p>

      <div className="mt-1 flex items-start gap-1">
        <svg
          viewBox="0 0 168 158"
          className="h-[132px] w-[142px] shrink-0 overflow-visible"
          role="img"
          aria-label="学习、生活、健康三个方向对这个选项的影响"
        >
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="currentColor" className="text-border" strokeWidth={1} />
          <circle
            cx={CX}
            cy={CY}
            r={R * 0.55}
            fill="none"
            stroke="currentColor"
            className="text-border/70"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {axes.map((a) => {
            const edge = point(a.angle, R);
            return (
              <line
                key={`spoke-${a.id}`}
                x1={CX}
                y1={CY}
                x2={edge.x}
                y2={edge.y}
                stroke="currentColor"
                className="text-border/70"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            );
          })}

          <polygon
            points={outline}
            fill={HEX.academic}
            fillOpacity={0.14}
            stroke={HEX.academic}
            strokeOpacity={0.55}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />

          {axes.map((a) => {
            const label = point(a.angle, R + 15);
            const active = openId === a.id;
            const name = AGENT_META[a.id].name;
            return (
              <g
                key={a.id}
                onClick={() => toggle(a.id)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${name}：影响 ${Math.round(a.impact * 100)}%，点开看利弊`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(a.id);
                  }
                }}
              >
                <circle cx={label.x} cy={label.y} r={17} fill="transparent" />
                <circle
                  cx={a.at.x}
                  cy={a.at.y}
                  r={active ? 4.6 : 3.6}
                  fill={HEX[a.id]}
                  stroke="#fff"
                  strokeWidth={1.2}
                />
                <text
                  x={label.x}
                  y={label.y + 3}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={active ? 700 : 500}
                  fill={HEX[a.id]}
                >
                  {name}
                </text>

              </g>
            );
          })}
        </svg>

        <div className="min-w-0 flex-1 space-y-1 pt-1">
          {axes.map((a) => {
            const name = AGENT_META[a.id].name;
            const active = openId === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                aria-expanded={active}
                className={cn(
                  'flex w-full items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEX[a.id] }} />
                  <span className="font-medium" style={{ color: HEX[a.id] }}>
                    {name}
                  </span>
                  <span className="text-[9.5px] text-muted-foreground/80">
                    ×{a.review?.weight ?? 1}
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/80">
                  {Math.round(a.impact * 100)}%
                </span>
              </button>
            );
          })}
          <p className="px-1.5 pt-0.5 text-[10px] leading-snug text-muted-foreground/70">
            点方向看这一条的一利一弊
          </p>
        </div>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[15.5rem] rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: HEX[open.agentId] }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEX[open.agentId] }} />
              {AGENT_META[open.agentId].name}
              <span className="text-[9.5px] font-normal text-muted-foreground">×{open.weight}</span>
              <span className="text-[9.5px] font-normal text-muted-foreground">
                影响 {Math.round(open.impact * 100)}%
              </span>
            </p>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-foreground/90">
            <span className="mr-1 text-primary/80">＋</span>
            {open.pro}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            <span className="mr-1">－</span>
            {open.con}
          </p>
        </div>
      )}
    </div>
  );
}
