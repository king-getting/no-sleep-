import { useEffect, useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BedDouble, Moon, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { bedtimeRegularity, sleepDebt, weekOverWeek } from '@/data/queries';
import { deleteSleepLog, getProfile, getSleepLogs, listChoicesToday, upsertSleepLog } from '@/data/store/profile';
import { buildDietSummary, type DietSummary } from '@/lib/dietSummary';
import { DIRECTION_META } from '@/ui/directionMeta';
import type { SleepLog } from '@/types/contract';

/**
 * B6 · 健康模块：睡眠手动录入 + 一周睡眠/精力趋势
 *
 * 两个刻意的取舍：
 * 1. 精力不是实测值，是「按时长推算」的估算，图上和图例都写明——不给用户假精度。
 * 2. 缺觉（<7h）的柱子换红色，并配一条 7.5h 参考线；不用「颜色渐变」这种好看但读不出结论的做法。
 */

const SLEEP_TARGET = 7.5;
const LOW_SLEEP = 7;

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 入睡日期口径：昨晚 = 昨天那条。默认填昨天，因为早上补录的就是昨晚。 */
function lastNightKey(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}

const WEEK_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function labelOf(date: string): { md: string; wd: string } {
  const d = new Date(`${date}T00:00:00`);
  return { md: `${d.getMonth() + 1}/${d.getDate()}`, wd: WEEK_LABEL[d.getDay()] };
}

/** bedTimeMin 允许 >1440 表示次日凌晨（示例数据里 0:40 就存成 1480） */
function fmtBed(min?: number): string {
  if (min === undefined || Number.isNaN(min)) return '—';
  const nextDay = min >= 1440;
  const m = ((min % 1440) + 1440) % 1440;
  const text = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return nextDay ? `次日 ${text}` : text;
}

/** 精力估算：以 8h 为满格，缺觉再扣分，下限 30 上限 100 */
function energyOf(hours: number): number {
  const base = (hours / 8) * 100;
  const penalty = hours < 6 ? 12 : hours < LOW_SLEEP ? 6 : 0;
  return Math.round(Math.max(30, Math.min(100, base - penalty)));
}

export default function Health() {
  const [logs, setLogs] = useState<SleepLog[] | null>(null);
  const [date, setDate] = useState(() => lastNightKey(new Date()));
  const [hours, setHours] = useState('7');
  const [bed, setBed] = useState('23:30');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);

  async function reload() {
    try {
      setLogs(await getSleepLogs());
      setLoadError(null);
    } catch (e) {
      // 读失败原本会永远停在「正在读本机记录…」
      console.error('[小山] 读取睡眠记录失败：', e);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (loadError && !logs) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="font-medium">睡眠记录没能读出来</p>
        <p className="mt-1 text-sm text-muted-foreground">记录存在本机，重试一次通常就好。</p>
        <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-card p-2 text-left font-mono text-[11px] text-muted-foreground">
          {loadError}
        </pre>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          重新加载
        </Button>
      </div>
    );
  }

  if (!logs) {
    return <p className="p-10 text-center text-sm text-muted-foreground">正在读本机记录…</p>;
  }

  // 近 7 晚（到昨晚为止）：入睡日期口径下，今天那一栏是「今晚还没睡」，没有展示价值
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (7 - i));
    const key = dateStr(d);
    const log = logs.find((l) => l.date === key);
    return { key, log, ...labelOf(key) };
  });

  const filled = week.filter((w) => w.log);
  const avg = filled.length > 0 ? filled.reduce((s, w) => s + (w.log?.hours ?? 0), 0) / filled.length : 0;
  const lowDays = filled.filter((w) => (w.log?.hours ?? 0) < LOW_SLEEP).length;
  const beds = filled.map((w) => w.log?.bedTimeMin).filter((v): v is number => typeof v === 'number');
  const avgBed = beds.length > 0 ? Math.round(beds.reduce((s, v) => s + v, 0) / beds.length) : undefined;

  const chartData = week.map((w) => ({
    label: w.wd,
    md: w.md,
    hours: w.log?.hours ?? 0,
    energy: w.log ? energyOf(w.log.hours) : null,
    missing: !w.log,
  }));

  // 一周尺度的三条：欠了多少、稳不稳、比上周如何（都只算有记录的晚数）
  const debt = sleepDebt(logs, 7, now);
  const rhythm = bedtimeRegularity(logs, 7, now);
  const compare = weekOverWeek(logs, now);
  const rhythmLabel =
    rhythm === null ? '' : rhythm.stdMin < 30 ? '稳' : rhythm.stdMin < 60 ? '一般' : rhythm.stdMin < 90 ? '偏乱' : '很乱';
  const debtLabel = debt === null ? '' : debt.debtHours === 0 ? '没欠' : debt.debtHours < 3 ? '略欠' : debt.debtHours < 6 ? '欠了一些' : '欠得多';

  async function save() {
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 2 || h > 14) {
      toast.error('睡眠时长填 2–14 小时之间');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error('日期格式不对');
      return;
    }
    setSaving(true);
    try {
      let bedTimeMin: number | undefined;
      if (/^\d{2}:\d{2}$/.test(bed)) {
        const [hh, mm] = bed.split(':').map(Number);
        bedTimeMin = hh * 60 + mm;
        // 睡前时间在中午之前，视为次日凌晨（0:40 记账为 1480）
        if (bedTimeMin < 12 * 60) bedTimeMin += 1440;
      }
      await upsertSleepLog({ date, hours: h, bedTimeMin });
      await reload();
      toast.success(`${date} 已记 ${h} 小时`, {
        description: '这条只存在本机。它会影响明早报告里的睡眠判断。',
      });
    } catch (e) {
      // 写失败不能静默：按钮恢复原样、用户以为存了，是最糟的一种「成功」
      console.error('[小山] 记录睡眠失败：', e);
      toast.error('这条没存进本机', { description: '检查浏览器是否允许本机存储后再试一次。' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(key: string) {
    try {
      await deleteSleepLog(key);
      await reload();
      toast('已删除这条记录');
    } catch (e) {
      console.error('[小山] 删除睡眠记录失败：', e);
      toast.error('这条没能删掉，请重试');
    }
  }

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[1200px] px-4 py-6 pb-24 lg:pb-10 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">健康</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          只记睡眠时长和入睡时间，不接手环、不上传。缺觉超过一晚，{`早上的报告`} 会把午间小憩排到前面。
        </p>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* ── 录入 ── */}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <BedDouble className="h-4 w-4" />
          补一条睡眠记录
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <label className="col-span-2 block text-xs text-muted-foreground lg:col-span-1">
            入睡日期（昨晚就选昨天）
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            睡了多久（小时）
            <input
              type="number"
              inputMode="decimal"
              min={2}
              max={14}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            几点睡（可不填）
            <input
              type="time"
              value={bed}
              onChange={(e) => setBed(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <div className="col-span-2 flex items-end lg:col-span-1">
            <Button onClick={() => void save()} disabled={saving} className="w-full">
              {saving ? '保存中…' : '记下'}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          同一天重复记录会覆盖，不会累加。凌晨 0:40 入睡请选 00:40，系统会自动按「次日」记账。
          日期按「哪天晚上睡的」算：昨晚那一觉，日期就选昨天。
        </p>
      </section>

      <div className="space-y-4">
      {/* ── 趋势 ── */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Moon className="h-4 w-4" />
            近 7 晚
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" />
              ≥{LOW_SLEEP}h
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-destructive" />
              缺觉
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-foreground/40" />
              精力估算
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 border-t border-dashed border-muted-foreground" />
              建议 {SLEEP_TARGET}h
            </span>
          </div>
        </div>

        {filled.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            这七天还没有记录。补第一条，上面的图就会长出来。
          </p>
        ) : (
          <>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 10]}
                    ticks={[0, 2, 4, 6, 8, 10]}
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(label, payload) => {
                      const p = payload?.[0]?.payload as { md?: string } | undefined;
                      return p?.md ? `${p.md} ${label}` : String(label);
                    }}
                    formatter={(value) => [Number(value) === 0 ? '未录入' : `${value} 小时`, '睡眠']}
                  />
                  <ReferenceLine
                    y={SLEEP_TARGET}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    {chartData.map((row) => (
                      <Cell
                        key={row.md}
                        fill={
                          row.missing
                            ? 'hsl(var(--muted))'
                            : row.hours < LOW_SLEEP
                              ? 'hsl(var(--destructive))'
                              : 'hsl(142 60% 42%)'
                        }
                      />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* 精力单独一条迷你曲线：和时长共用一套横轴，但纵轴是 0–100，不混在一个刻度里 */}
            <div className="mt-1 flex items-center gap-2">
              <span className="w-14 shrink-0 text-[11px] text-muted-foreground">精力估算</span>
              <div className="h-14 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 8 }}>
                    <YAxis domain={[0, 100]} hide />
                    <XAxis dataKey="label" hide />
                    <Area
                      type="monotone"
                      dataKey="energy"
                      stroke="hsl(142 60% 42%)"
                      fill="hsl(142 60% 42% / 0.16)"
                      strokeWidth={2}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">平均睡眠</p>
                <p className={`text-lg font-semibold ${filled.length === 0 ? 'text-muted-foreground' : avg < LOW_SLEEP ? 'text-destructive' : ''}`}>
                  {filled.length === 0 ? '—' : avg.toFixed(1)}
                  {filled.length > 0 && <span className="text-xs font-normal text-muted-foreground">h</span>}
                </p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">不足 7h</p>
                <p className={`text-lg font-semibold ${lowDays > 0 ? 'text-destructive' : ''}`}>
                  {lowDays}
                  <span className="text-xs font-normal text-muted-foreground">/{filled.length} 晚</span>
                </p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">平均入睡</p>
                <p className="text-lg font-semibold">{fmtBed(avgBed)}</p>
              </div>
            </div>

            {/* 一周尺度：欠多少 / 稳不稳 / 比上周 */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">
                  睡眠债 <span className="text-muted-foreground/70">· {debtLabel || '—'}</span>
                </p>
                <p className={`text-lg font-semibold ${debt && debt.debtHours >= 6 ? 'text-destructive' : ''}`}>
                  {debt === null ? '—' : debt.debtHours.toFixed(1)}
                  {debt !== null && <span className="text-xs font-normal text-muted-foreground">h</span>}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  {debt === null ? '没有记录' : `近 ${debt.covered} 晚按 7.5h 算`}
                </p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">
                  入睡波动 <span className="text-muted-foreground/70">· {rhythmLabel || '—'}</span>
                </p>
                <p className={`text-lg font-semibold ${rhythm && rhythm.stdMin >= 90 ? 'text-destructive' : ''}`}>
                  {rhythm === null ? '—' : `±${rhythm.stdMin}`}
                  {rhythm !== null && <span className="text-xs font-normal text-muted-foreground">分</span>}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  {rhythm === null ? '不足两晚记录' : `<30 稳 · 30–60 一般 · >90 乱`}
                </p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">比上周</p>
                <p
                  className={`text-lg font-semibold ${
                    compare.delta === null ? 'text-muted-foreground' : compare.delta >= 0 ? '' : 'text-destructive'
                  }`}
                >
                  {compare.delta === null
                    ? '—'
                    : `${compare.delta >= 0 ? '+' : ''}${compare.delta.toFixed(1)}`}
                  {compare.delta !== null && <span className="text-xs font-normal text-muted-foreground">h</span>}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  {compare.thisWeek === null
                    ? '本周没有记录'
                    : `本周 ${compare.thisWeek.toFixed(1)}h${
                        compare.lastWeek === null ? ' · 上周没有记录' : ` · 上周 ${compare.lastWeek.toFixed(1)}h`
                      }`}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              精力线是「按睡眠时长推算的估算值」，不是实测——只用来看出趋势，别拿它当体检结论。
            </p>
          </>
        )}
      </section>

      {/* ── 饮食总结 ── */}
      <DietSection />

      {/* ── 明细 ── */}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">这一周的记录</h2>
        <ul className="divide-y">
          {week.map((w) => (
            <li key={w.key} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{w.md}</span>
                <span className="w-10 shrink-0 text-sm">{w.wd}</span>
                {w.log ? (
                  <span className={`text-sm ${w.log.hours < LOW_SLEEP ? 'text-destructive' : ''}`}>
                    {w.log.hours} 小时
                    <span className="ml-2 text-xs text-muted-foreground">{fmtBed(w.log.bedTimeMin)} 睡</span>
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">未录入</span>
                )}
              </div>
              {w.log ? (
                <button
                  type="button"
                  onClick={() => void remove(w.key)}
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setDate(w.key)}
                  className="flex shrink-0 items-center gap-1 text-xs text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  补录
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      </div>
      </div>
    </div>
  );
}

/**
 * 饮食总结：把你今天在报告里点过的饭点选，算成三个 方向 的看法
 *
 * 为什么不自己猜你今天吃了什么：小山不拍照片、也不接外卖账号。
 * 唯一的真实信号是「你点过哪张选项卡」，所以这里只统计点过的，
 * 没点就明说没点——空态比编造的一顿饭诚实。
 */
function DietSection() {
  const [diet, setDiet] = useState<DietSummary | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [records, user] = await Promise.all([listChoicesToday(), getProfile()]);
        if (!alive) return;
        setDiet(buildDietSummary(records, user.mealBudgetMonthly ? Math.round((user.mealBudgetMonthly / 30) * 10) / 10 : 0));
      } catch {
        if (alive) setDiet(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!diet) return null;

  if (diet.isEmpty) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <UtensilsCrossed className="h-4 w-4" />
          今天吃了什么
        </h2>
        <p className="text-sm text-muted-foreground">
          还没点过任何一顿。去「报告」里点一张午饭/晚饭的选项卡，这里就会按你实际点的算分——不拍照片、不接外卖账号。
        </p>
      </section>
    );
  }

  const tone =
    diet.gradeTone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
      : diet.gradeTone === 'ok' ? 'text-amber-600 dark:text-amber-400'
        : 'text-destructive';

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <UtensilsCrossed className="h-4 w-4" />
          今天吃了什么
        </h2>
        <div className="text-right">
          <p className={`text-2xl font-semibold leading-none tabular-nums ${tone}`}>
            {diet.score}
            <span className="ml-1 text-xs font-normal text-muted-foreground">/ 100</span>
          </p>
          <p className={`mt-0.5 text-[11px] ${tone}`}>{diet.grade}</p>
        </div>
      </div>

      <ul className="mb-3 flex flex-wrap gap-1.5">
        {diet.meals.map((m, i) => (
          <li key={`${m.topic}-${i}`} className="rounded-full border bg-secondary/40 px-2 py-0.5 text-[11px]">
            <span className="text-muted-foreground">{m.topic}</span> · {m.title}
            {m.price !== undefined && <span className="ml-1 tabular-nums text-muted-foreground">¥{m.price}</span>}
          </li>
        ))}
      </ul>

      <ul className="space-y-2">
        {diet.dims.map((d) => {
          const meta = DIRECTION_META[d.directionId];
          const bar = d.score >= 85 ? 'bg-emerald-500' : d.score >= 65 ? 'bg-amber-500' : 'bg-destructive';
          return (
            <li key={d.directionId} className="rounded-lg border bg-background/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium">{d.label}</span>
                <span className="text-[11px] text-muted-foreground">{meta?.name}</span>
                <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{d.score}</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${d.score}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">为什么：{d.reason}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                <span className="text-foreground/80">下一步：</span>
                {d.tip}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
