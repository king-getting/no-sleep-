import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OverviewItem } from '@/types/contract';

export function OverviewBlock({ items }: { items: OverviewItem[] }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="text-sm font-medium text-muted-foreground">概览</h3>
      <dl className="mt-2 space-y-2">
        {items.map((item) => {
          const tone = cn(
            'min-w-0',
            item.tone === 'warn' && 'font-medium text-amber-600',
            item.tone === 'danger' && 'font-medium text-destructive',
          );
          return (
            <div key={item.label} className="flex items-baseline gap-3 text-sm">
              <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
              {item.link ? (
                <dd className={tone}>
                  <Link
                    to={item.link}
                    className="group inline-flex items-baseline gap-0.5 underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-foreground"
                    aria-label={`${item.label}：${item.value}，点开看整周课表`}
                  >
                    {item.value}
                    <ArrowUpRight className="h-3 w-3 shrink-0 translate-y-px text-muted-foreground group-hover:text-foreground" />
                  </Link>
                </dd>
              ) : (
                <dd className={tone}>{item.value}</dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
