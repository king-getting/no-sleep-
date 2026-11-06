import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import type { AgentId, AgentReview } from '@/types/contract';
import { AGENT_META } from '@/ui/agentMeta';
import { cn } from '@/lib/utils';

/**
 * 三个方向的雷达图（学习 / 生活 / 健康）
 *
 * 三条轴固定，顶点离中心越远表示这个选项在该方向上影响越大（impact 0–1）。
 * 一利一弊不铺在卡片上：点顶点或标签才弹，弹层用 portal 挂到 body 上、fixed 定位，
 * 这样不会被相邻卡片或顶栏盖住，也不会被卡片边界裁掉。
 */

const AXES: { id: AgentId; angle: number }[] = [
  { id: 'academic', angle: -90 },
  { id: 'life', angle: 30 },
  { id: 'health', angle: 150 },
];

/**
 * 每个方向一套渐变：同一张卡里，谁的影响最大就用谁的配色当主色。
 * 同一组选项卡并排时，一眼能分出"这张卡主要是睡眠问题还是钱的问题"。
 */
const GRAD: Record<AgentId, [string, string]> = {
  academic: ['#2F4F43', '#6FA08A'],
  life: ['#B4762A', '#E3B776'],
  health: ['#3F6E8C', '#93BBD2'],
  schedule: ['#5A5F7A', '#A2A8C4'],
};

const CX = 84;
const CY = 76;
const R = 46;
const MIN_R = 9;

/** 把三个方向的颜色按影响大小混成一个色：形状不同，卡片的色调就不同 */
function mixTint(weights: { id: AgentId; w: number }[], lighten = 0): string {
  const sum = weights.reduce((s, x) => s + x.w, 0) || 1;
  const rgb = [0, 0, 0];
  for (const { id, w } of weights) {
    const hex = GRAD[id][0];
    const n = w / sum;
    rgb[0] += parseInt(hex.slice(1, 3), 16) * n;
    rgb[1] += parseInt(hex.slice(3, 5), 16) * n;
    rgb[2] += parseInt(hex.slice(5, 7), 16) * n;
  }
  const toHex = (v: number) => {
    const c = Math.round(v + (255 - v) * lighten);
    return Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  };
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** 每个选项一个稳定的色相微调：图案接近的两张卡，颜色也不会完全一样 */
function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function shiftHue(hex: string, deg: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const hue = (h + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(rgb[0]) + toHex(rgb[1]) + toHex(rgb[2]);
}

const PANEL_W = 250;
const PANEL_GAP = 8;
const PANEL_EST_H = 132;

function point(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: CX + Math.cos(rad) * radius, y: CY + Math.sin(rad) * radius };
}

export default function ReviewRadar({ reviews, seed }: { reviews: AgentReview[]; seed?: string }) {
  const [openId, setOpenId] = useState<AgentId | null>(null);
  const [anchorBox, setAnchorBox] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const byId = new Map(reviews.map((r) => [r.agentId, r]));

  const axes = AXES.map((axis) => {
    const review = byId.get(axis.id);
    const impact = Math.min(1, Math.max(0, review?.impact ?? 0));
    // 开根号：5% 和 90% 的差别肉眼要分得出来，直接线性会把小值压成一个点
    const radius = MIN_R + Math.sqrt(impact) * (R - MIN_R);
    return { ...axis, review, impact, at: point(axis.angle, radius) };
  });

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchorBox({ left: r.left, top: r.top, bottom: r.bottom });
  }, []);

  const close = useCallback(() => {
    setOpenId(null);
    anchorRef.current = null;
    setAnchorBox(null);
  }, []);

  const toggle = useCallback(
    (id: AgentId, el: HTMLElement) => {
      if (openId === id) {
        close();
        return;
      }
      anchorRef.current = el;
      place();
      setOpenId(id);
    },
    [openId, place, close],
  );

  // 打开时：点外面 / Esc 关掉，滚动与缩放时跟着锚点走
  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onMove = () => place();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [openId, close, place]);

  const open = axes.find((a) => a.id === openId)?.review ?? null;
  const outline = axes.map((a) => `${a.at.x.toFixed(1)},${a.at.y.toFixed(1)}`).join(' ');
  // 哪条轴影响最大，就用它的配色画这张三角；渐变从"最大"扫向"次大"，
  // 同组几张卡对比时，颜色和方向都不一样，扫一眼就知道差在哪。
  const dominant = axes.reduce((a, b) => (b.impact > a.impact ? b : a), axes[0]);
  const second = axes
    .filter((a) => a.id !== dominant.id)
    .reduce((a, b) => (b.impact > a.impact ? b : a), axes.find((a) => a.id !== dominant.id)!);
  const gd = point(dominant.angle, R * 0.92);
  const gs = point(second.angle, R * 0.92);
  const hueShift = seed ? (hashSeed(seed) % 41) - 20 : 0;
  const tint = shiftHue(mixTint(axes.map((a) => ({ id: a.id, w: a.impact + 0.04 }))), hueShift);
  const tintLight = shiftHue(mixTint(axes.map((a) => ({ id: a.id, w: a.impact + 0.04 })), 0.55), hueShift);
  const gradId = `radar${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [expanded, setExpanded] = useState(false);

  const panelStyle = (() => {
    if (!anchorBox) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, anchorBox.left), Math.max(8, vw - PANEL_W - 8));
    const below = anchorBox.bottom + PANEL_GAP;
    const flip = below + PANEL_EST_H > vh - 8;
    const top = flip ? Math.max(8, anchorBox.top - PANEL_EST_H - PANEL_GAP) : below;
    return { left, top, width: PANEL_W, position: 'fixed' as const, zIndex: 2147483000 };
  })();

  return (
    <div className="relative mt-1.5" onClick={(e) => e.stopPropagation()}>
      <p className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80 sm:block">
        三个方向怎么看
      </p>

      {/* 手机端默认收起：卡片本来就窄，先给标题和选项让位 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-md py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80 sm:hidden"
      >
        三个方向怎么看
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
      </button>

      <div className={cn('mt-1 gap-1', expanded ? 'flex items-start' : 'hidden sm:flex sm:items-start')}>
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

          <defs>
            <linearGradient
              id={gradId}
              gradientUnits="userSpaceOnUse"
              x1={gd.x}
              y1={gd.y}
              x2={gs.x}
              y2={gs.y}
            >
              <stop offset="0%" stopColor={tint} stopOpacity={0.58} />
              <stop offset="100%" stopColor={tintLight} stopOpacity={0.30} />
            </linearGradient>
          </defs>

          <polygon
            points={outline}
            fill={`url(#${gradId})`}
            stroke={tint}
            strokeOpacity={0.6}
            strokeWidth={1.7}
            strokeLinejoin="round"
          />

          {axes.map((a) => {
            const label = point(a.angle, R + 15);
            const active = openId === a.id;
            const name = AGENT_META[a.id].name;
            return (
              <g
                key={a.id}
                onClick={(e) => toggle(a.id, e.currentTarget as unknown as HTMLElement)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${name}：影响 ${Math.round(a.impact * 100)}%，点开看利弊`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(a.id, e.currentTarget as unknown as HTMLElement);
                  }
                }}
              >
                <circle cx={label.x} cy={label.y} r={17} fill="transparent" />
                <circle
                  cx={a.at.x}
                  cy={a.at.y}
                  r={active ? 4.6 : 3.6}
                  fill={GRAD[a.id][0]}
                  stroke="#fff"
                  strokeWidth={1.2}
                />
                <text
                  x={label.x}
                  y={label.y + 3}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={active ? 700 : 500}
                  fill={GRAD[a.id][0]}
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
                onClick={(e) => toggle(a.id, e.currentTarget)}
                aria-expanded={active}
                className={cn(
                  'flex w-full items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: GRAD[a.id][0] }} />
                  <span className="font-medium" style={{ color: GRAD[a.id][0] }}>
                    {name}
                  </span>
                  <span className="text-[9.5px] text-muted-foreground/80">×{a.review?.weight ?? 1}</span>
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

      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`${AGENT_META[open.agentId].name}对这一条的利弊`}
            style={panelStyle}
            className="rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className="flex items-center gap-1.5 text-[11.5px] font-medium"
                style={{ color: GRAD[open.agentId][0] }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: GRAD[open.agentId][0] }} />
                {AGENT_META[open.agentId].name}
                <span className="text-[9.5px] font-normal text-muted-foreground">×{open.weight}</span>
                <span className="text-[9.5px] font-normal text-muted-foreground">
                  影响 {Math.round(open.impact * 100)}%
                </span>
              </p>
              <button
                type="button"
                onClick={close}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
