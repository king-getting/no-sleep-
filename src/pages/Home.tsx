import { useCallback, useEffect, useRef, useState } from 'react';
import { onDataChanged } from '@/lib/dataEvents';
import { Flower2, Mountain, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { orchestrator, type Trigger } from '@/orchestrator';
import { currentSlot, slotKey } from '@/lib/reportSlot';
import { ensureSeeded, forgetConflictChoice, markCompliance, recordChoice, rememberConflictChoice, undoChoice, undoCompliance } from '@/data/store/profile';
import type { OptionCard } from '@/types/contract';
import { OrchestrationTimeline } from '@/ui/animation/OrchestrationTimeline';
import { DebatePanel } from '@/ui/reports/DebatePanel';
import { RiskPanel } from '@/ui/reports/RiskPanel';
import { ReportView } from '@/ui/reports/ReportView';
import OutlookSection from '@/ui/outlook/OutlookSection';
import type { Report } from '@/types/contract';


export default function Home() {
  const [report, setReport] = useState<Report | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, 'A' | 'B'>>({});
  /** 晚间闭环：suggestionId -> 是否做了（只做记录，不追责） */
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  /** 生成失败时给一个能重试的出口，而不是让首屏永远停在「正在生成…」 */
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // 风险项挪到左栏：右列只留概览/选项卡/冲突/总结，否则 9 条风险把卡片顶到两屏之外
  const riskItems = report ? report.blocks.filter((b) => b.kind === 'warning') : [];
  const reportBody = report
    ? { ...report, blocks: report.blocks.filter((b) => b.kind !== 'warning') }
    : null;

  const run = useCallback(async (trigger: Trigger, now: Date) => {
    setError(null);
    try {
      const r = await orchestrator.run(trigger, { now });
      setReport(r);
      setMarks({}); // 新一轮报告 = 新一轮闭环，上一轮的「已记录」不再展示
    } catch (e) {
      console.error('[小山] 生成报告失败：', e);
      setError(e instanceof Error ? e.message : String(e));
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
    if (autoRan.current) return;
    autoRan.current = true;
    void ensureSeeded()
      .then(runCurrentSlot)
      .catch((e: unknown) => {
        console.error('[小山] 初始化失败：', e);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [runCurrentSlot, retryTick]);

  // 对话里改了课表 / 睡眠 / 餐标，报告要跟着重算
  useEffect(
    () =>
      onDataChanged(() => {
        autoRan.current = false;
        setRetryTick((v) => v + 1);
      }),
    [],
  );

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

  const handlePick = useCallback((suggestionId: string, optionId: string, topic: string, option?: OptionCard) => {
    // 再点一次同一张卡 = 取消选择；同时删掉刚才那条记录，别让它污染偏好
    if (picks[suggestionId] === optionId) {
      setPicks((p) => {
        const next = { ...p };
        delete next[suggestionId];
        return next;
      });
      void undoChoice(suggestionId, optionId).then(
        () => toast('已取消选择', { description: '这次点选不会计入偏好。' }),
        () => toast.error('取消没生效，稍后再试一次'),
      );
      return;
    }

    setPicks((p) => ({ ...p, [suggestionId]: optionId }));
    // 连选项快照一起存：健康页的饮食总结要回看「吃了什么、多少钱、有没有蔬菜」
    const meta = option
      ? JSON.stringify({
          title: option.title,
          price: option.cost?.money,
          nutrition: option.nutrition,
          note: option.note,
        })
      : undefined;
    // 先落库再提示：写失败时不能对用户说「已记入」
    void recordChoice(suggestionId, optionId, topic, meta).then(
      () => {
        toast('已记入本地偏好', { description: '后续建议会参考你的这次选择，数据只存在这台设备上。' });
      },
      (e: unknown) => {
        console.error('[小山] 记录偏好失败：', e);
        toast.error('这次选择没能存到本机', { description: '可以稍后再点一次，或检查浏览器是否允许本机存储。' });
      },
    );
  }, [picks]);

  const handleResolve = useCallback(
    (conflictId: string, topic: string, choice: 'A' | 'B') => {
      // 再点同一侧 = 取消裁决，并忘掉「下次预填」
      if (resolutions[conflictId] === choice) {
        setResolutions((r) => {
          const next = { ...r };
          delete next[conflictId];
          return next;
        });
        void forgetConflictChoice(topic).then(
          () => toast('已取消裁决', { description: '同类冲突下次不会再预填这个选择。' }),
          () => toast.error('取消没生效，稍后再试一次'),
        );
        return;
      }
      setResolutions((r) => ({ ...r, [conflictId]: choice }));
      void rememberConflictChoice(topic, choice).then(
        () => {
          toast('裁决已记住', { description: '同类冲突下次默认预填这次的选择，仍可一键切换。' });
        },
        (e: unknown) => {
          console.error('[小山] 记录裁决失败：', e);
          toast.error('裁决没能存到本机');
        },
      );
    },
    [resolutions],
  );
  /** 晚间闭环（§4.6/§4.7）：做了 / 没做 一键标记，写回遵从度画像；措辞中性，不追责 */
  const handleMark = useCallback((suggestionId: string, topic: string, done: boolean) => {
    setMarks((m) => ({ ...m, [suggestionId]: done }));
    void markCompliance(topic, done).then(
      () => {
        toast(done ? '已记录：做完了' : '已记录：这次没做', {
          description: '只用来调整下次建议的轻重，不用于评价你。',
        });
      },
      (e: unknown) => {
        console.error('[小山] 记录执行情况失败：', e);
        setMarks((m) => {
          const next = { ...m };
          delete next[suggestionId];
          return next;
        });
        toast.error('这次没能记下来', { description: '界面已回退，稍后再点一次就好。' });
      },
    );
  }, []);

  /** 点「已记录」徽标撤销：删记录并把遵从度画像退回去 */
  const handleUnmark = useCallback((suggestionId: string, topic: string, done: boolean) => {
    setMarks((m) => {
      const next = { ...m };
      delete next[suggestionId];
      return next;
    });
    void undoCompliance(topic, done).then(
      () => toast('已撤销标记', { description: '这条记录删掉了，画像也退回去了。' }),
      () => toast.error('撤销没生效，稍后再试一次'),
    );
  }, []);

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[1320px] px-4 sm:px-6 pb-24 lg:pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 pt-4 pb-3 lg:hidden">
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
        </div>
      </header>

      {error && report && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <span>这一轮没能重新生成（{error.slice(0, 60)}），下面显示的还是上一次的报告。</span>
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              autoRan.current = false;
              setRetryTick((n) => n + 1);
            }}
          >
            重试
          </button>
        </div>
      )}

      {/* 手机端（<lg）报告在前、编排时间轴在后：375px 上先看到结论而不是先看一屏动效 */}
      <main className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
        {/* 桌面端把编排时间轴钉住：报告很长，往下翻时左侧一直能看到「谁在什么时候说了什么」 */}
        <div className="order-2 lg:order-1">
          <OrchestrationTimeline />
          {report && <RiskPanel items={riskItems} />}
        </div>
        <div className="order-1 lg:order-2">
          {report ? (
            <>
              {/* 报告之前先给「这一轮是几方在争、各自否掉了什么」——折叠态只占一行 */}
              <DebatePanel report={report} resolutions={resolutions} />
              <ReportView
                report={reportBody ?? report}
                picks={picks}
                resolutions={resolutions}
                marks={marks}
                onPick={handlePick}
                onResolve={handleResolve}
                onMark={handleMark}
                onUnmark={handleUnmark}
              />
            </>
          ) : error ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6">
              <p className="font-medium">这一刻没能生成报告</p>
              <p className="mt-1 text-sm text-muted-foreground">
                数据都在本机，重试一次通常就好；如果一直失败，多半是浏览器拦了本地存储。
              </p>
              <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 font-mono text-[11px] text-muted-foreground">
                {error}
              </pre>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    autoRan.current = false;
                    setRetryTick((n) => n + 1);
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                  再试一次
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                  重新加载
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
              正在生成第一张报告…
            </p>
          )}
        </div>
      </main>

      <OutlookSection />
    </div>
  );
}
