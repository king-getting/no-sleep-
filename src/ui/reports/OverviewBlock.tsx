import { Fragment } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OverviewItem } from '@/types/contract';

export function OverviewBlock({ items, hideLabels }: { items: OverviewItem[]; hideLabels?: string[] }) {
  const shown = hideLabels ? items.filter((item) => !hideLabels.includes(item.label)) : items;
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="text-sm font-medium text-muted-foreground">概览</h3>
      {/* 定宽标签列：四行的值都从同一条竖线开始，扫一眼就能对上，不用每行重新找起点 */}
      <dl className="mt-2.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        {shown.map((item) => {
          const tone = cn(
            'min-w-0',
            item.tone === 'warn' && 'font-medium text-amber-600',
            item.tone === 'danger' && 'font-medium text-destructive',
          );
          return (
            <Fragment key={item.label}>
              <dt className="pt-px text-xs leading-6 text-muted-foreground sm:text-sm">{item.label}</dt>
              {item.link ? (
                <dd className={cn(tone, 'text-sm')}>
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
                <dd className={cn(tone, 'text-sm')}>{item.value}</dd>
              )}
            </Fragment>
          );
        })}
      </dl>
    </section>
  );
}
