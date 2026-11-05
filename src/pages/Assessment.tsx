import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getPreferences, savePreferences } from '@/data/store/profile';
import {
  QUESTIONS,
  TRAIT_LABEL,
  TRAIT_NOTE,
  effectsOf,
  scoreAnswers,
  traitsLine,
  type Answers,
} from '@/lib/assessment';
import type { HabitTraits } from '@/types/contract';

/**
 * 习惯倾向测评（§4.9 画像扩展）
 *
 * 12 题、每题一屏、可随时退出。结果不是「贴标签」，而是四个能直接改排期的参数：
 * 单块时长、提前天数、每日配额、优先时段。
 */

export default function Assessment({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<HabitTraits | null>(null);
  const [saving, setSaving] = useState(false);

  const q = QUESTIONS[index];
  const total = QUESTIONS.length;
  const answered = Object.keys(answers).length;

  function pick(score: number) {
    const next = { ...answers, [q.id]: score };
    setAnswers(next);
    if (index + 1 < total) setIndex(index + 1);
    else setResult(scoreAnswers(next));
  }

  const fx = result ? effectsOf(result) : null;

  async function save() {
    if (!result) return;
    setSaving(true);
    try {
      const prefs = await getPreferences();
      await savePreferences({ ...prefs, traits: result });
      toast('画像已保存', { description: '下一次生成复习草案就会按它来排。' });
      onDone();
    } catch (err) {
      toast('保存失败', { description: err instanceof Error ? err.message : String(err) });
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-4 pb-28 pt-8 lg:pb-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-xl font-bold">习惯倾向测评</h1>
        {result ? (
          <span className="text-xs text-muted-foreground">已完成</span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {index + 1} / {total}
          </span>
        )}
      </div>

      {!result && (
        <>
          <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(answered / total) * 100}%` }}
            />
          </div>

          <section className="flex-1">
            <h2 className="font-serif text-lg font-semibold leading-relaxed">{q.text}</h2>
            <p className="mt-1 text-xs text-muted-foreground">按第一反应选，没有对错。</p>
            <div className="mt-5 space-y-2.5">
              {q.choices.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => pick(c.score)}
                  className="w-full rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/5"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </section>

          <div className="mt-6 flex justify-between">
            <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              上一题
            </Button>
            <Button variant="ghost" className="text-muted-foreground" onClick={onDone}>
              先跳过
            </Button>
          </div>
        </>
      )}

      {result && fx && (
        <section className="space-y-5">
          <div>
            <p className="text-xs text-muted-foreground">你的任务习惯</p>
            <p className="mt-1 font-serif text-xl font-bold">{traitsLine(result)}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ['节奏', TRAIT_LABEL[result.rhythm], TRAIT_NOTE[result.rhythm]],
              ['计划', TRAIT_LABEL[result.structure], TRAIT_NOTE[result.structure]],
              ['专注', TRAIT_LABEL[result.focus], TRAIT_NOTE[result.focus]],
              ['推进', TRAIT_LABEL[result.drive], TRAIT_NOTE[result.drive]],
            ].map(([k, label, note]) => (
              <div key={k} className="rounded-xl border bg-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
                <div className="mt-0.5 text-sm font-semibold">{label}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <div className="font-medium">这四项会直接改排期：</div>
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              <li>单块复习 {fx.focusMinutes} 分钟（短于这个会被合并，不再切碎）</li>
              <li>往前排 {fx.horizonDays} 天（考得太远就先不占你的空档）</li>
              <li>每天最多 {fx.dayBudget} 分钟，优先{fx.preferSlot === 'morning' ? '上午' : '晚上'}的空档</li>
            </ul>
          </div>

          <div className="flex justify-between pt-1">
            <Button variant="ghost" onClick={() => { setResult(null); setAnswers({}); setIndex(0); }}>
              重测
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存并开始用'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
