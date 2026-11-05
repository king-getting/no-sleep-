import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/data/store/db';
import { getPreferences, savePreferences } from '@/data/store/profile';
import { useToday } from '@/hooks/useToday';
import {
  courseOccursOn,
  defaultSemesterStart,
  formatWeeks,
  mondayOf,
  toDateKey,
  weekOfDate,
} from '@/lib/weeks';
import { fmtMin } from '@/types/contract';
import type { Course } from '@/types/contract';
import { Button } from '@/components/ui/button';

/**
 * 月视图：按真实日期铺日历，每格只放「那天真正要上的课」
 *
 * 与周历的区别：周历是「课表模板」，这里叠加了教学周——
 * 1,3,5…周才上的课，只有单周那几天出现。今天、当月都跟系统时间走，
 * 跨零点或切回前台会自动对齐（useToday）。
 */

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'] as const;

function ymd(d: Date): string {
  return toDateKey(d);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Month() {
  const today = useToday();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(today);
  const [editingStart, setEditingStart] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      // 先读偏好：示例模式的种子数据是在 getPreferences 里灌的，先读一次课程才不会读到空表
      const prefs = await getPreferences().catch(() => null);
      const rows = await db.courses.toArray();
      let start = prefs?.semesterStart;
      // 第一次进：给个合理的开学日（秋季 9 月 1 日那周的周一），之后完全由用户改
      if (!start) {
        start = defaultSemesterStart(new Date());
        if (prefs) await savePreferences({ ...prefs, semesterStart: start });
      }
      if (!active) return;
      setCourses(rows);
      setSemesterStart(start);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // 月份切换后，「今天」按钮要能回到当月
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(today);
  };

  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
  const currentWeek = weekOfDate(today, semesterStart);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = mondayOf(first);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const offset = Math.round((first.getTime() - start.getTime()) / 86_400_000);
    const rows = Math.ceil((offset + daysInMonth) / 7);
    return Array.from({ length: rows * 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const byDate = useMemo(() => {
    const map = new Map<string, Course[]>();
    for (const d of grid) {
      const list = courses
        .filter((c) => courseOccursOn(c, d, semesterStart))
        .sort((a, b) => a.startMin - b.startMin);
      if (list.length) map.set(ymd(d), list);
    }
    return map;
  }, [grid, courses, semesterStart]);

  const selectedCourses = byDate.get(ymd(selected)) ?? [];
  const selectedWeek = weekOfDate(selected, semesterStart);

  async function saveSemesterStart(value: string) {
    if (!value) return;
    setSemesterStart(value);
    const prefs = await getPreferences().catch(() => null);
    if (prefs) await savePreferences({ ...prefs, semesterStart: value });
    setEditingStart(false);
    toast('学期第一周已更新', { description: '日历按新的周次重算。' });
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-6 lg:pb-10 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{monthLabel}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentWeek ? `今天是第 ${currentWeek} 周` : '还没设置学期第一周'}
            {semesterStart ? ` · 学期开始 ${semesterStart}` : ''}
            <button
              type="button"
              className="ml-2 underline underline-offset-2 hover:text-foreground"
              onClick={() => setEditingStart((v) => !v)}
            >
              改
            </button>
          </p>
          {editingStart && (
            <input
              type="date"
              value={semesterStart ?? defaultSemesterStart(today)}
              onChange={(e) => void saveSemesterStart(e.target.value)}
              className="mt-2 h-8 rounded-md border bg-background px-2 text-xs"
              aria-label="学期第一周的周一"
            />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            aria-label="上个月"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={goToday}>
            今天
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="下个月"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] text-muted-foreground">
          {WEEK_HEAD.map((d) => (
            <div key={d} className="py-1.5">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((d) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = sameDay(d, today);
            const isSelected = sameDay(d, selected);
            const list = byDate.get(ymd(d)) ?? [];
            return (
              <button
                key={ymd(d)}
                type="button"
                onClick={() => setSelected(d)}
                className={[
                  'relative min-h-[72px] border-b border-r p-1 text-left align-top transition-colors last:border-r-0 sm:min-h-[92px]',
                  inMonth ? 'bg-card hover:bg-muted/40' : 'bg-muted/20 text-muted-foreground',
                  isSelected ? 'ring-1 ring-inset ring-primary/50' : '',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={[
                      'flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                      isToday ? 'bg-primary text-primary-foreground' : '',
                    ].join(' ')}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {list.slice(0, 2).map((c) => (
                    <div
                      key={c.id}
                      className="truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] leading-tight text-primary"
                      title={`${c.name} ${fmtMin(c.startMin)}-${fmtMin(c.endMin)}`}
                    >
                      {c.name}
                    </div>
                  ))}
                  {list.length > 2 && (
                    <div className="pl-1 text-[10px] text-muted-foreground">+{list.length - 2}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-4 rounded-2xl border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {selected.getMonth() + 1} 月 {selected.getDate()} 日 · 周{WEEK_HEAD[selected.getDay() === 0 ? 6 : selected.getDay() - 1]}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {selectedWeek ? `第 ${selectedWeek} 周` : '学期外'}
            {selectedCourses.length > 0 ? ` · ${selectedCourses.length} 门课` : ' · 没课'}
          </span>
        </div>

        {loading ? (
          <p className="mt-2 text-xs text-muted-foreground">正在读本机课表…</p>
        ) : selectedCourses.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            这一天没有课。如果是单双周课程，换一周看看；也可能是学期第一周设错了，点上面的「改」调一下。
          </p>
        ) : (
          <ul className="mt-2 divide-y">
            {selectedCourses.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.location}
                    {c.teacher ? ` · ${c.teacher}` : ''} · {formatWeeks(c.weeks)}
                  </div>
                </div>
                <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {fmtMin(c.startMin)}–{fmtMin(c.endMin)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
