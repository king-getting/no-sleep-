import { useCallback, useEffect, useRef, useState } from 'react';
import { Flower2, Mountain, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { orchestrator, type Trigger } from '@/orchestrator';
import { atTime, currentSlot, slotKey } from '@/lib/reportSlot';
import { ensureSeeded, getPreferences, markCompliance, optOutNoAsk, recordChoice, rememberConflictChoice } from '@/data/store/profile';
import { bootMode } from '@/data/store/boot';
import { OrchestrationTimeline } from '@/ui/animation/OrchestrationTimeline';
import { ReportView } from '@/ui/reports/ReportView';
import type { Report } from '@/types/contract';

/** 演示模式：手动唤出任意时段的报告（§4.9 路演刚需） */
const TRIGGERS: { trigger: Trigger; label: string; time: string; now: () => Date }[] = [
  { trigger: 'morning-report', label: '晨间报告', time: '7:30', now: () => atTime(7, 30) },
  { trigger: 'noon-report', label: '午间报告', time: '11:30', now: () => atTime(11, 30) },
  { trigger: 'evening-report', label: '晚间报告', time: '21:30', now: () => atTime(21, 30) },
];

export default function Home() {
  const [report, setReport] = useState<Report | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, 'A' | 'B'>>({});
  /** 晚间闭环：suggestionId -> 是否做了（只做记录，不追责） */
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  /** 晚间闭环：topic -> 已记录的「没做」归因（起晚了/不饿/没时间/忘了） */
  const [markReasons, setMarkReasons] = useState<Record<string, string>>({});
  /** §4.7「不再追问」的主题集合 */
  const [noAsk, setNoAsk] = useState<Record<string, true>>({});
  const [running, setRunning] = useState(false);

  const run = useCallback(async (trigger: Trigger, now: Date) => {
    setRunning(true);
    try {
      const r = await orchestrator.run(trigger, { now });
      setReport(r);
      setMarks({}); // 新一轮报告 = 新一轮闭环，上一轮的「已记录」不再展示
      const prefs = await getPreferences();
      setMarkReasons(prefs.missReasons ?? {});
      setNoAsk(prefs.noAsk ?? {});
    } finally {
      setRunning(false);
    }
  }, []);

  // 记录「上一次生成的是哪个时段」，用于轮询判断是否跨段 / 跨天
  const lastSlot = useRef<string>('');

  const runCurrentSlot = useCallback(async () => {
    const slot = currentSlot();
    lastSlot.current = slotKey(slot);
    await run(slot.trigger, slot.at);
  }, [run]);

  const autoRan = useRef(false);
  useEffect(() => {
    // 首屏即演示：填充示例数据后按「当前时段」自动生成报告（守卫避免 StrictMode 双跑）
    if (autoRan.current) return;
    autoRan.current = true;
    void ensureSeeded().then(runCurrentSlot);
  }, [runCurrentSlot]);

  // A5：本地定时触发器。每分钟检查所处时段，变化即重新生成（含跨天补生成）
  useEffect(() => {
    const id = window.setInterval(() => {
      const slot = currentSlot();
      const key = slotKey(slot);
      if (key === lastSlot.current) return;
      lastSlot.current = key;
      void run(slot.trigger, slot.at);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [run]);

  const handlePick = useCallback((suggestionId: string, optionId: string, topic: string) => {
    setPicks((p) => ({ ...p, [suggestionId]: optionId }));
    void recordChoice(suggestionId, optionId, topic).then(() => {
      toast('已记入本地偏好', { description: '后续建议会参考你的这次选择，数据只存在这台设备上。' });
    });
  }, []);

  const handleResolve = useCallback((conflictId: string, topic: string, choice: 'A' | 'B') => {
    setResolutions((r) => ({ ...r, [conflictId]: choice }));
    void rememberConflictChoice(topic, choice).then(() => {
      toast('裁决已记住', { description: '同类冲突下次默认预填这次的选择，仍可一键切换。' });
    });
  }, []);

  /** 晚间闭环（§4.6/§4.7）：做了 / 没做 一键标记；没做时带归因，次日换成更轻的选项卡 */
  const handleMark = useCallback((suggestionId: string, topic: string, done: boolean, reason?: string) => {
    setMarks((m) => ({ ...m, [suggestionId]: done }));
    setMarkReasons((r) => {
      const next = { ...r };
      if (!done && reason) next[topic] = reason;
      if (done) delete next[topic];
      return next;
    });
    void markCompliance(topic, done, reason).then(() => {
      toast(done ? '已记录：做完了' : reason ? `已记录：这次没做（${reason}）` : '已记录：这次没做', {
        description: done
          ? '只用来调整下次建议的轻重，不用于评价你。'
          : '明天晨间会给你一张为这个原因准备的更轻选项。',
      });
    });
  }, []);

  /** §4.7：一键「不再追问」，关闭即停 */
  const handleNoAsk = useCallback((topic: string) => {
    setNoAsk((n) => ({ ...n, [topic]: true }));
    void optOutNoAsk(topic).then(() => {
      toast('好的，这个主题以后不再追问', { description: '随时可以清掉数据重来。' });
    });
  }, []);

  return (
    <div className="mx-auto min-h-[100dvh] max-w-6xl px-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Mountain className="h-6 w-6" />
            <Flower2 className="absolute -right-1 -top-1 h-4 w-4 text-amber-300" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold leading-tight">小山</h1>
            <p className="text-xs text-muted-foreground">CCUNER 的本地小助手</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 font-normal">
            <ShieldCheck className="h-3 w-3 text-primary" />
            本地优先 · 数据不出设备
          </Badge>
          {bootMode() === 'demo' && <Badge variant="secondary" className="font-normal">示例数据</Badge>}
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-xs">
        <span className="px-1 text-sm text-muted-foreground">
          {bootMode() === 'demo' ? '演示模式 · 手动唤出：' : '手动唤出报告：'}
        </span>
        {TRIGGERS.map((t) => (
          <Button
            key={t.trigger}
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() => void run(t.trigger, t.now())}
          >
            {t.label} <span className="ml-1 text-xs text-muted-foreground">{t.time}</span>
          </Button>
        ))}
      </div>

      {/* 手机端（<lg）报告在前、编排时间轴在后：375px 上先看到结论而不是先看一屏动效 */}
      <main className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        {/* 桌面端把编排时间轴钉住：报告很长，往下翻时左侧一直能看到「谁在什么时候说了什么」 */}
        <div className="order-2 lg:sticky lg:top-4 lg:order-1 lg:self-start">
          <OrchestrationTimeline />
        </div>
        <div className="order-1 lg:order-2">
          {report ? (
            <ReportView
              report={report}
              picks={picks}
              resolutions={resolutions}
              marks={marks}
              markReasons={markReasons}
              noAsk={noAsk}
              onPick={handlePick}
              onResolve={handleResolve}
              onMark={handleMark}
              onNoAsk={handleNoAsk}
            />
          ) : (
            <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
              正在生成第一张报告…
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
