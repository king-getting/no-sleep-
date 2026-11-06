import { useEffect, useState } from 'react';
import { CalendarClock, CalendarRange, ClipboardCheck } from 'lucide-react';
import { db } from '@/data/store/db';
import { getPreferences, getProfile } from '@/data/store/profile';
import { buildFacts, type FactBundle } from '@/lib/facts';
import { generateBrief, templateGenerator, type Brief } from '@/lib/brief';
import { modelGenerator } from '@/lib/modelBrief';
import { generateOutlookNarrative, readOutlookCache, type OutlookNarrative } from '@/lib/modelOutlook';
import { isLlmReady } from '@/lib/llmSettings';
import { onDataChanged } from '@/lib/dataEvents';
import DailyBrief from '@/ui/brief/DailyBrief';
import {
  daysUntil,
  fmtHour,
  nextWeekForecast,
  shortDate,
  twoDayForecast,
  weekSummary,
  weekdayLabel,
  type WeekForecast,
  type WeekSummary,
} from '@/lib/outlook';
import type { DayPlan } from '@/lib/outlook';
import type { Course, ExamItem, SleepLog } from '@/types/contract';

/**
 * 首页底部的三块预报：
 *   未来两天（课 + 截止项）
 *   下周（课程量分布 + 下周考试）
 *   本周总结（课、复习、睡眠、遵从度）
 *
 * 全部读本机 IndexedDB，和报告用的是同一份数据；不做网络请求。
 */

const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function Card({
  icon,
  title,
  extra,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function CourseLine({ course }: { course: Course }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{fmtHour(course.startMin)}</span>
      <span className="truncate">{course.name}</span>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{course.location}</span>
    </div>
  );
}

function DayBlock({ plan, label }: { plan: DayPlan; label: string }) {
  return (
    <div className="rounded-xl border bg-background/60 p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium">
          {label} <span className="text-muted-foreground">{shortDate(plan.date)} {weekdayLabel(plan.date)}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {plan.courses.length ? `${plan.courses.length} 节` : '没课'}
        </span>
      </div>
      <div className="space-y-1">
        {plan.courses.slice(0, 3).map((c) => (
          <CourseLine key={c.id} course={c} />
        ))}
        {plan.courses.length > 3 && (
          <p className="pl-12 text-[10px] text-muted-foreground">还有 {plan.courses.length - 3} 节</p>
        )}
        {plan.exams.map((e) => (
          <p key={e.id} className="text-[11px] text-amber-700 dark:text-amber-300">
            {e.kind === 'exam' ? '考试' : '截止'} · {e.title}
          </p>
        ))}
        {plan.courses.length === 0 && plan.exams.length === 0 && (
          <p className="text-[11px] text-muted-foreground">空着，适合安排整块复习</p>
        )}
      </div>
    </div>
  );
}

/** 模型写的那句话：有就显示，来自模型就标明，不冒充系统结论 */
function NarrativeLine({ text }: { text: string }) {
  return (
    <p className="mt-2 rounded-lg bg-primary/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/85">
      <span className="font-medium text-primary">小山说</span>
      <span className="mx-1 text-muted-foreground">·</span>
      {text}
    </p>
  );
}

export default function OutlookSection() {
  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [sleeps, setSleeps] = useState<SleepLog[]>([]);
  const [blocks, setBlocks] = useState<{ date: string; startMin: number; endMin: number; done: boolean }[]>([]);
  const [compliance, setCompliance] = useState<{ date: string; done: boolean }[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | undefined>(undefined);
  const [bundle, setBundle] = useState<FactBundle | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [narrative, setNarrative] = useState<OutlookNarrative | null>(() => readOutlookCache());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const prefs = await getPreferences().catch(() => null);
      const [cs, es, ss, bs, cp] = await Promise.all([
        db.courses.toArray(),
        db.exams.toArray(),
        db.sleepLogs.toArray(),
        db.reviewBlocks.toArray(),
        db.compliance.toArray(),
      ]);
      if (!active) return;
      const now = new Date();
      const blockRows = bs.map((b) => ({ date: b.date, startMin: b.startMin, endMin: b.endMin, done: b.done }));
      const complianceRows = cp.map((c) => ({ date: c.date, done: c.done }));
      const profile = await getProfile().catch(() => null);

      // 事实包 → 简报：先算事实，再生成，最后校验；失败由 generateBrief 内部回落模板
      const factBundle = buildFacts({
        now,
        courses: cs,
        exams: es,
        sleeps: ss,
        blocks: blockRows,
        compliance: complianceRows,
        semesterStart: prefs?.semesterStart,
        profile,
      });
      // 配了模型就走模型生成，没配 / 失败都自动回落模板
      const composed = await generateBrief(
        factBundle,
        now,
        isLlmReady() ? modelGenerator() : templateGenerator,
      );

      if (!active) return;
      setCourses(cs);
      setExams(es);
      setSleeps(ss);
      setBlocks(blockRows);
      setCompliance(complianceRows);
      setSemesterStart(prefs?.semesterStart);
      setBundle(factBundle);
      setBrief(composed);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [tick]);

  // 对话里改了数据、或刚配好模型，都要重新算一遍
  useEffect(() => {
    const bump = () => setTick((v) => v + 1);
    const offData = onDataChanged(bump);
    window.addEventListener('xiaoshan:llm-changed', bump);
    return () => {
      offData();
      window.removeEventListener('xiaoshan:llm-changed', bump);
    };
  }, []);

  // 三句话交给模型写；没配模型 / 失败就整段不显示，不留空壳。
  // 注意：必须放在早返回之前，否则 hooks 顺序会变（React #310）。
  useEffect(() => {
    if (!ready || narrative || !isLlmReady()) return;
    const now = new Date();
    const twoDays = twoDayForecast(now, courses, exams, semesterStart);
    const nextWeek = nextWeekForecast(now, courses, exams, semesterStart);
    const summary = weekSummary(now, courses, exams, sleeps, blocks, compliance, semesterStart);
    let active = true;
    void generateOutlookNarrative(twoDays, nextWeek, summary)
      .then((n) => {
        if (active && n) setNarrative(n);
      })
      .catch(() => {
        /* 模型写不出来就不写，卡片本身的数据还在 */
      });
    return () => {
      active = false;
    };
  }, [ready, narrative, courses, exams, sleeps, blocks, compliance, semesterStart]);

  if (!ready) {
    return <div className="mt-5 h-32 animate-pulse rounded-2xl border bg-card" />;
  }

  const now = new Date();
  const twoDays = twoDayForecast(now, courses, exams, semesterStart);
  const nextWeek: WeekForecast = nextWeekForecast(now, courses, exams, semesterStart);
  const summary: WeekSummary = weekSummary(
    now,
    courses,
    exams,
    sleeps,
    blocks,
    compliance,
    semesterStart,
  );

  const maxPerDay = Math.max(1, ...nextWeek.days.map((d) => d.courses.length));


  const hasAnyCourse = courses.length > 0;

  return (
    <div className="mt-5 space-y-4">
      {brief && bundle && <DailyBrief brief={brief} bundle={bundle} />}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card
        icon={<CalendarClock className="h-4 w-4 text-primary" />}
        title="未来两天"
        extra={<span className="text-[10px] text-muted-foreground">按课表 + 周次</span>}
      >
        <div className="space-y-2">
          <DayBlock plan={twoDays[0]} label="明天" />
          <DayBlock plan={twoDays[1]} label="后天" />
        </div>
        {narrative?.twoDays && <NarrativeLine text={narrative.twoDays} />}
        {!hasAnyCourse && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            还没导入课表，去「周历 → 从 Excel 导入」把教务系统的表放进来，这里就会填满。
          </p>
        )}
      </Card>

      <Card
        icon={<CalendarRange className="h-4 w-4 text-primary" />}
        title="下周预报"
        extra={
          <span className="text-[10px] text-muted-foreground">
            {shortDate(nextWeek.monday)}–{shortDate(new Date(nextWeek.monday.getTime() + 6 * 86_400_000))}
          </span>
        }
      >
        <div className="mb-3 flex items-end gap-1.5">
          {nextWeek.days.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`w-full rounded-t ${d.courses.length ? 'bg-primary/70' : 'bg-muted'}`}
                style={{ height: `${d.courses.length ? Math.max(8, (d.courses.length / maxPerDay) * 44) : 3}px` }}
                title={`${WEEK_CN[i]} ${d.courses.length} 节`}
              />
              <span className="text-[10px] text-muted-foreground">{WEEK_CN[i].slice(1)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {nextWeek.courseCount > 0 ? (
            <>
              共 <span className="font-medium text-foreground">{nextWeek.courseCount}</span> 节
              {nextWeek.busiest && (
                <>，最忙 {weekdayLabel(nextWeek.busiest.date)}（{nextWeek.busiest.courses.length} 节）</>
              )}
              {nextWeek.days.filter((d) => d.courses.length === 0).length > 0 && (
                <>，{nextWeek.days.filter((d) => d.courses.length === 0).length} 天没课</>
              )}
            </>
          ) : (
            '下周没有排课（也可能是学期周次没覆盖到）'
          )}
        </p>
        {nextWeek.exams.length > 0 && (
          <ul className="mt-2 space-y-1">
            {nextWeek.exams.slice(0, 3).map((e) => (
              <li key={e.id} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
                  {e.kind === 'exam' ? '考试' : 'DDL'}
                </span>
                <span className="truncate">{e.title}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {shortDate(new Date(e.at))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {narrative?.nextWeek && <NarrativeLine text={narrative.nextWeek} />}
      </Card>

      <Card
        icon={<ClipboardCheck className="h-4 w-4 text-primary" />}
        title="本周总结"
        extra={<span className="text-[10px] text-muted-foreground">周一起算</span>}
      >
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border bg-background/60 p-2">
            <dt className="text-[10px] text-muted-foreground">本周课程</dt>
            <dd className="text-sm font-semibold">
              {summary.courseCount} <span className="text-[10px] font-normal text-muted-foreground">节 · {Math.round(summary.courseMinutes / 60)}h</span>
            </dd>
          </div>
          <div className="rounded-lg border bg-background/60 p-2">
            <dt className="text-[10px] text-muted-foreground">复习完成</dt>
            <dd className="text-sm font-semibold">
              {summary.reviewDone}/{summary.reviewPlanned}
              {summary.reviewPlanned > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  {Math.round((summary.reviewDone / summary.reviewPlanned) * 100)}%
                </span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border bg-background/60 p-2">
            <dt className="text-[10px] text-muted-foreground">平均睡眠</dt>
            <dd className="text-sm font-semibold">
              {summary.sleepAvg !== null ? `${summary.sleepAvg}h` : '—'}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">{summary.sleepNights} 晚</span>
            </dd>
          </div>
          <div className="rounded-lg border bg-background/60 p-2">
            <dt className="text-[10px] text-muted-foreground">建议执行</dt>
            <dd className="text-sm font-semibold">
              {summary.complianceDone}/{summary.complianceTotal}
            </dd>
          </div>
        </dl>
        {summary.worstNight && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            最缺觉：{shortDate(new Date(`${summary.worstNight.date}T00:00:00`))}，只睡 {summary.worstNight.hours}h
          </p>
        )}
        {summary.upcoming && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            接下来：{summary.upcoming.title}，还有 {daysUntil(summary.upcoming.at, now)} 天
          </p>
        )}
        {narrative?.lastWeek && <NarrativeLine text={narrative.lastWeek} />}
      </Card>
      </div>
    </div>
  );
}
