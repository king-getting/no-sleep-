import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import {
  computeTimeBlocks,
  coursesOfDay,
  hasBackToBack,
  hasEarlyEight,
  lunchCrunch,
} from '@/data/queries';
import { dayOfWeek, fmtMin } from '@/types/contract';
import type { Course, TimeBlock } from '@/types/contract';

/**
 * B3 · 「我的这一周」时间轴视图（§4.2）
 *
 * 只读视图：把本地课表按天切成「上课 / 整块空档 / 碎片」三类色块，
 * 风险项（早八、连排、午休被吃掉、整天没有整块空档）置顶标红。
 * 数据全部走 queries.ts 的纯函数，和报告里的口径完全一致——报告说「午休被吃掉」，
 * 这里同一格就是红的，不会出现两处不一致。
 */

const DAY_START = 7 * 60;
const DAY_END = 23 * 60;
const HOUR_PX = 36;
const WINDOW_PX = ((DAY_END - DAY_START) / 60) * HOUR_PX;

const WEEK_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const DOWS = [1, 2, 3, 4, 5, 6, 7] as const;

type DayData = { dow: (typeof DOWS)[number]; courses: Course[]; blocks: TimeBlock[] };

type Risk = {
  dow: number;
  kind: 'lunch' | 'early' | 'busy' | 'nogap';
  title: string;
  detail: string;
};

const RISK_ORDER: Record<Risk['kind'], number> = { lunch: 0, early: 1, busy: 2, nogap: 3 };

function monthDay(base: Date, dow: number): string {
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((dayOfWeek(base) - 1) % 7));
  const d = new Date(monday);
  d.setDate(monday.getDate() + (dow - 1));
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function y(topMin: number, bottomMin: number) {
  return {
    top: ((topMin - DAY_START) / 60) * HOUR_PX,
    height: Math.max(((bottomMin - topMin) / 60) * HOUR_PX - 2, 3),
  };
}

function blockStyle(kind: TimeBlock['kind'], isLunchCrunch: boolean): string {
  const base = 'absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight';
  if (kind === 'class') {
    return `${base} border-primary/40 bg-primary/10 text-primary ${isLunchCrunch ? 'ring-1 ring-destructive/70' : ''}`;
  }
  if (kind === 'free') {
    return `${base} border-dashed border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`;
  }
  return 'absolute inset-x-1 overflow-hidden rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] leading-tight text-muted-foreground';
}

function buildRisks(days: DayData[]): Risk[] {
  const risks: Risk[] = [];
  for (const day of days) {
    const label = WEEK_LABEL[day.dow - 1];
    const lunch = lunchCrunch(day.courses);
    if (lunch) {
      risks.push({
        dow: day.dow,
        kind: 'lunch',
        title: `${label} 午休被吃掉`,
        detail: `「${lunch.name}」${fmtMin(lunch.startMin)}–${fmtMin(lunch.endMin)} 压在 11:30–13:00 上，午后第一节课容易犯困。`,
      });
    }
    if (hasEarlyEight(day.courses)) {
      const early = day.courses.find((c) => c.startMin <= 480);
      risks.push({
        dow: day.dow,
        kind: 'early',
        title: `${label} 早八`,
        detail: early
          ? `${fmtMin(early.startMin)} 就要到「${early.location}」上${early.name}，前一晚睡得晚会连环掉状态。`
          : '8:00 前有课。',
      });
    }
    if (hasBackToBack(day.courses)) {
      risks.push({
        dow: day.dow,
        kind: 'busy',
        title: `${label} 连排`,
        detail: '相邻两节课间隔不到 15 分钟，中间几乎没有喘息和吃饭的时间。',
      });
    }
    if (day.courses.length > 0 && !day.blocks.some((b) => b.kind === 'free')) {
      risks.push({
        dow: day.dow,
        kind: 'nogap',
        title: `${label} 整天没有整块空档`,
        detail: '只有碎片时间——想复习整块内容只能往晚上或别的日子挪。',
      });
    }
  }
  return risks.sort((a, b) => RISK_ORDER[a.kind] - RISK_ORDER[b.kind] || a.dow - b.dow);
}

export default function Week() {
  const [days, setDays] = useState<DayData[] | null>(null);
  const now = useMemo(() => new Date(), []);
  const today = dayOfWeek(now);
  const [picked, setPicked] = useState<number>(today);

  useEffect(() => {
    void (async () => {
      const loaded = await Promise.all(
        DOWS.map(async (dow) => {
          const courses = await coursesOfDay(dow);
          return { dow, courses, blocks: computeTimeBlocks(courses, DAY_START, DAY_END) };
        }),
      );
      setDays(loaded);
    })();
  }, []);

  if (!days) {
    return <p className="p-10 text-center text-sm text-muted-foreground">正在排这一周…</p>;
  }

  const risks = buildRisks(days);
  const courseCount = days.reduce((s, d) => s + d.courses.length, 0);
  const freeCount = days.reduce((s, d) => s + d.blocks.filter((b) => b.kind === 'free').length, 0);

  return (
    <div className="mx-auto min-h-[100dvh] max-w-6xl px-4 py-6 pb-24">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">我的这一周</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按你录入的课表切色块：{courseCount} 门次课、{freeCount} 段整块空档。报告里说「午休被吃掉」，这里同一格就是红的。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-primary/40 bg-primary/10" />上课
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-emerald-600/40 bg-emerald-500/10" />
            整块空档（≥2h）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-muted" />碎片
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-primary/40 bg-primary/10 ring-1 ring-destructive/70" />
            红框＝午休被吃掉
          </span>
        </div>
      </header>

      {risks.length > 0 ? (
        <section className="mb-5 space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            这周要留意 {risks.length} 处
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {risks.map((r) => (
              <div key={`${r.dow}-${r.kind}`} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">{r.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="mb-5 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          这周没有明显风险：没有早八、没有连排，午休也保住了。想加课的话，挑整块空档最多那天。
        </section>
      )}

      {/* 小屏：一天一屏 + 星期切换；大屏：七列并排 */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto lg:hidden">
        {DOWS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setPicked(d)}
            className={`flex-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs ${
              picked === d ? 'border-primary/60 bg-primary/10 text-primary' : 'text-muted-foreground'
            }`}
          >
            {WEEK_LABEL[d - 1]}
            {d === today ? ' ·今' : ''}
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-7">
        {days.map((day) => {
          const isToday = day.dow === today;
          const lunch = lunchCrunch(day.courses);
          const md = monthDay(now, day.dow);
          return (
            <div
              key={day.dow}
              className={`rounded-lg border bg-card ${isToday ? 'ring-1 ring-primary/40' : ''} ${
                day.dow === picked ? '' : 'hidden lg:block'
              }`}
            >
              <div className="border-b px-2 py-1.5">
                <div className="flex items-baseline justify-between">
                  <span className={`text-sm ${isToday ? 'font-semibold text-primary' : 'font-medium'}`}>
                    {WEEK_LABEL[day.dow - 1]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{md}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {day.courses.length === 0
                    ? '没课'
                    : `${day.courses.length} 门次 · 整块 ${day.blocks.filter((b) => b.kind === 'free').length} 段`}
                </p>
              </div>

              <div
                className="relative"
                style={{
                  height: WINDOW_PX,
                  backgroundImage:
                    'repeating-linear-gradient(to bottom, hsl(var(--border)) 0 1px, transparent 1px ' +
                    `${HOUR_PX}px)`,
                }}
              >
                {day.blocks.map((b) => {
                  const box = y(b.startMin, b.endMin);
                  const isCrunch = b.kind === 'class' && !!lunch && b.label === lunch.name;
                  const hours = (b.endMin - b.startMin) / 60;
                  const span = `${hours.toFixed(1).replace(/\.0$/, '')}h`;
                  const label =
                    b.kind === 'class' ? b.label : b.kind === 'free' ? `空 ${span}` : '碎片';
                  return (
                    <div
                      key={`${b.kind}-${b.startMin}`}
                      className={blockStyle(b.kind, isCrunch)}
                      style={{ top: box.top, height: box.height }}
                      title={`${fmtMin(b.startMin)}–${fmtMin(b.endMin)}${b.label ? ` ${b.label}` : ''}`}
                    >
                      {box.height >= 26 && (
                        <>
                          <span className="block truncate font-medium">{label}</span>
                          <span className="block truncate opacity-80">
                            {fmtMin(b.startMin)}–{fmtMin(b.endMin)}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
                {day.courses.length === 0 && (
                  <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 text-center text-[11px] text-muted-foreground">
                    这天没课，整天空着
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        时间轴固定 07:00–23:00；色块高度按真实时长换算，宽窄不代表重要性。想改课表→设置页的「我的画像」。
      </p>
    </div>
  );
}
