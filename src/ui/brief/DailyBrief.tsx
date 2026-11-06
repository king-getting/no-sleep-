import { useState } from 'react';
import { ChevronDown, Link2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Brief } from '@/lib/brief';
import type { FactBundle } from '@/lib/facts';

/**
 * 今日简报：结构化结论 + 可展开的依据
 *
 * 每条结论都挂着 factIds，点「依据」能看到它引用的原始事实——
 * 这就是「可解释」在数据层的落地，不再靠文案自证。
 */
export default function DailyBrief({ brief, bundle }: { brief: Brief; bundle: FactBundle }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          今日简报
        </h2>
        <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
          {brief.generatedBy === 'template' ? '本地生成 · 不联网' : '模型生成 · 已校验'}
        </span>
      </div>

      <p className="font-serif text-lg font-bold leading-snug">{brief.headline}</p>

      <ul className="mt-2 space-y-1.5">
        {brief.points.map((p, i) => {
          const open = openIndex === i;
          return (
            <li key={`${p.text}-${i}`}>
              <div className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <span className="min-w-0 flex-1">{p.text}</span>
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : i)}
                  className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  aria-expanded={open}
                >
                  <Link2 className="h-2.5 w-2.5" />
                  依据 {p.factIds.length}
                  <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-180')} />
                </button>
              </div>
              {open && (
                <ul className="ml-4 mt-1 space-y-0.5 border-l-2 border-primary/20 pl-2 text-[11px] text-muted-foreground">
                  {p.factIds.map((id) => (
                    <li key={id}>{bundle.byId[id]?.label ?? `（缺少事实 ${id}）`}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 rounded-lg bg-primary/5 px-2.5 py-1.5 text-xs text-foreground/90">{brief.advice}</p>
    </section>
  );
}
