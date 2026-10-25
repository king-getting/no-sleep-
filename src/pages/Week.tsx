import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, CalendarDays, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeTimeBlocks,
  coursesOfDay,
  hasBackToBack,
  hasEarlyEight,
  lunchCrunch,
} from '@/data/queries';
import { addCourse, deleteCourse, updateCourse } from '@/data/store/courses';
import { dayOfWeek, fmtMin } from '@/types/contract';
import type { Course, TimeBlock } from '@/types/contract';
import { Button } from '@/components/ui/button';
import { CourseSheet } from '@/ui/week/CourseSheet';
import { makeDraft } from '@/ui/week/draft';
import type { CourseDraft } from '@/ui/week/CourseSheet';

/**
 * B3 · 「我的这一周」时间轴视图（§4.2）
 *
 * 把本地课表按天切成「上课 / 整块空档 / 碎片」三类色块，
 * 风险项（早八、连排、午休被吃掉、整天没有整块空档）置顶标红。
 * 数据全部走 queries.ts 的纯函数，和报告里的口径完全一致——报告说「午休被吃掉」，
 * 这里同一格就是红的，不会出现两处不一致。
 *
 * 交互（本次新增）：点课程看详情/改名/删除；点空白处按点中的位置加课。
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

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

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

async function fetchDays(): Promise<DayData[]> {
  return Promise.all(
    DOWS.map(async (dow) => {
      const courses = await coursesOfDay(dow);
      return { dow, courses, blocks: computeTimeBlocks(courses, DAY_START, DAY_END) };
    }),
  );
}

export default function Week() {
  const [days, setDays] = useState<DayData[] | null>(null);
  const now = useMemo(() => new Date(), []);
  const today = dayOfWeek(now);
  // 从报告里的「今日课程」点进来会带 ?dow=3，落地即停在那一天
  const [searchParams] = useSearchParams();
  const targetDow = Number(searchParams.get('dow')) || null;
  const [picked, setPicked] = useState<number>(targetDow ?? today);
  const [draft, setDraft] = useState<CourseDraft | null>(null);
  // 每次打开都给面板一个新的 key：否则从「详情」切到「加课」时组件不会重挂载，
  // 里面 useState 的初始值还停在上一次（标题对、内容是旧的）
  const [draftSeq, setDraftSeq] = useState(0);

  const load = useCallback(async () => {
    setDays(await fetchDays());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchDays().then((loaded) => {
      if (active) setDays(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const openAdd = (dow: number, startMin: number, endMin: number) => {
    const base = makeDraft(dow, startMin, endMin);
    base.siblings = days?.find((d) => d.dow === dow)?.courses ?? [];
    setDraft(base);
    setDraftSeq((n) => n + 1);
  };

  const openDetail = (course: Course) => {
    setDraft({
      mode: 'edit',
      course,
      siblings: (days?.find((d) => d.dow === course.dayOfWeek)?.courses ?? []).filter((c) => c.id !== course.id),
    });
    setDraftSeq((n) => n + 1);
  };

  const save = async (course: Course, isNew: boolean) => {
    if (isNew) {
      await addCourse({ ...course, id: newId() });
      toast.success(`已加「${course.name}」`, { description: `${WEEK_LABEL[course.dayOfWeek - 1]} ${fmtMin(course.startMin)}–${fmtMin(course.endMin)}` });
    } else {
      await updateCourse(course.id, {
        name: course.name,
        teacher: course.teacher,
        location: course.location,
        dayOfWeek: course.dayOfWeek,
        startMin: course.startMin,
        endMin: course.endMin,
      });
      toast.success('已保存');
    }
    setDraft(null);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setPicked(course.dayOfWeek);
    await load();
  };

  const remove = async (course: Course) => {
    await deleteCourse(course.id);
    toast.success(`已删除「${course.name}」`);
    setDraft(null);
    await load();
  };

  if (!days) {
    return <p className="p-10 text-center text-sm text-muted-foreground">正在排这一周…</p>;
  }

  const risks = buildRisks(days);
  const courseCount = days.reduce((s, d) => s + d.courses.length, 0);
  const freeCount = days.reduce((s, d) => s + d.blocks.filter((b) => b.kind === 'free').length, 0);

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[1320px] px-4 sm:px-6 py-6 pb-24">
      <header className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">我的这一周</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              按你录入的课表切色块：{courseCount} 门次课、{freeCount} 段整块空档。报告里说「午休被吃掉」，这里同一格就是红的。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // 默认落在这一天第一段空档里；没有空档就放 20:00
              const day = days.find((d) => d.dow === picked) ?? days[0];
              const slot = day.blocks.find((b) => b.kind === 'free') ?? day.blocks.find((b) => b.kind === 'fragment');
              const start = slot ? slot.startMin : 20 * 60;
              openAdd(day.dow, start, Math.min(start + 100, DAY_END));
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            加课
          </Button>
        </div>
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
                day.dow === targetDow ? 'ring-2 ring-primary/70' : ''
              } ${day.dow === picked ? '' : 'hidden lg:block'}`}
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
                className="relative select-none"
                style={{
                  height: WINDOW_PX,
                  backgroundImage:
                    'repeating-linear-gradient(to bottom, hsl(var(--border)) 0 1px, transparent 1px ' +
                    `${HOUR_PX}px)`,
                }}
                onClick={(e) => {
                  // 点在最底层（没被色块盖住的地方）：按纵坐标换算成时间，吸附到 5 分钟
                  const rect = e.currentTarget.getBoundingClientRect();
                  const raw = DAY_START + ((e.clientY - rect.top) / HOUR_PX) * 60;
                  const snapped = Math.round(raw / 5) * 5;
                  openAdd(day.dow, Math.max(DAY_START, snapped), Math.max(DAY_START, snapped) + 100);
                }}
              >
                {/* 空档 / 碎片：点一下就在这个位置加课 */}
                {day.blocks
                  .filter((b) => b.kind !== 'class')
                  .map((b) => {
                    const box = y(b.startMin, b.endMin);
                    const span = `${((b.endMin - b.startMin) / 60).toFixed(1).replace(/\.0$/, '')}h`;
                    return (
                      <button
                        key={`${b.kind}-${b.startMin}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAdd(day.dow, b.startMin, b.endMin);
                        }}
                        aria-label={`${WEEK_LABEL[day.dow - 1]} ${fmtMin(b.startMin)} 空档，点这里加课`}
                        className={`${blockStyle(b.kind, false)} text-left transition-colors hover:border-primary/50 hover:bg-primary/5`}
                        style={{ top: box.top, height: box.height }}
                        title={`${fmtMin(b.startMin)}–${fmtMin(b.endMin)} · 点一下加课`}
                      >
                        {box.height >= 26 && (
                          <>
                            <span className="block truncate font-medium">{b.kind === 'free' ? `空 ${span}` : '碎片'}</span>
                            <span className="block truncate opacity-80">
                              {fmtMin(b.startMin)}–{fmtMin(b.endMin)}
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}

                {/* 课程块：点一下看详情 / 改 / 删 */}
                {day.courses.map((c) => {
                  const box = y(c.startMin, c.endMin);
                  const isCrunch = !!lunch && lunch.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(c);
                      }}
                      aria-label={`${c.name}，${fmtMin(c.startMin)} 到 ${fmtMin(c.endMin)}，点开看详情`}
                      className={`${blockStyle('class', isCrunch)} text-left transition-colors hover:bg-primary/20`}
                      style={{ top: box.top, height: box.height }}
                      title={`${c.name} · ${fmtMin(c.startMin)}–${fmtMin(c.endMin)} · ${c.location}`}
                    >
                      {box.height >= 26 && (
                        <>
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="block truncate opacity-80">
                            {fmtMin(c.startMin)}–{fmtMin(c.endMin)}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}

                {day.courses.length === 0 && day.blocks.length === 0 && (
                  <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 text-center text-[11px] text-muted-foreground">
                    这天没课，点空白处加一门
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        时间轴固定 07:00–23:00；色块高度按真实时长换算。点课程看详情，点空白处加课——改完报告里的空档和冲突会立刻跟着变。
      </p>

      {draft && (
        <CourseSheet
          key={draftSeq}
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  );
}
