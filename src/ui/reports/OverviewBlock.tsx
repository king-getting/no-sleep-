import { cn } from '@/lib/utils';
import type { OverviewItem } from '@/types/contract';

export function OverviewBlock({ items }: { items: OverviewItem[] }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="text-sm font-medium text-muted-foreground">概览</h3>
      <dl className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-3 text-sm">
            <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'min-w-0',
                item.tone === 'warn' && 'font-medium text-amber-600',
                item.tone === 'danger' && 'font-medium text-destructive',
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
