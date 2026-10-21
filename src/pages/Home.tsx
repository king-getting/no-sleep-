import { useCallback, useEffect, useRef, useState } from 'react';
import { Flower2, Mountain, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { orchestrator, type Trigger } from '@/orchestrator';
import { ensureSeeded, recordChoice, rememberConflictChoice } from '@/data/store/profile';
import { OrchestrationTimeline } from '@/ui/animation/OrchestrationTimeline';
import { ReportView } from '@/ui/reports/ReportView';
import type { Report } from '@/types/contract';

/** 演示模式：手动唤出任意时段的报告（§4.9 路演刚需） */
function atTime(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

const TRIGGERS: { trigger: Trigger; label: string; time: string; now: () => Date }[] = [
  { trigger: 'morning-report', label: '晨间报告', time: '7:30', now: () => atTime(7, 30) },
  { trigger: 'noon-report', label: '午间报告', time: '11:30', now: () => atTime(11, 30) },
  { trigger: 'evening-report', label: '晚间报告', time: '21:30', now: () => atTime(21, 30) },
];

export default function Home() {
  const [report, setReport] = useState<Report | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, 'A' | 'B'>>({});
  const [running, setRunning] = useState(false);

  const run = useCallback(async (trigger: Trigger, now: Date) => {
    setRunning(true);
    try {
      const r = await orchestrator.run(trigger, { now });
      setReport(r);
    } finally {
      setRunning(false);
    }
  }, []);

  const autoRan = useRef(false);
  useEffect(() => {
    // 首屏即演示：填充示例数据后自动唤出午间报告（杀手锏场景）；守卫避免 StrictMode 双跑
    if (autoRan.current) return;
    autoRan.current = true;
    void ensureSeeded().then(() => run('noon-report', atTime(11, 30)));
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

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16">
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
          <Badge variant="secondary" className="font-normal">示例数据</Badge>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-xs">
        <span className="px-1 text-sm text-muted-foreground">演示模式 · 手动唤出：</span>
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

      <main className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <OrchestrationTimeline />
        <div>
          {report ? (
            <ReportView report={report} picks={picks} resolutions={resolutions} onPick={handlePick} onResolve={handleResolve} />
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
