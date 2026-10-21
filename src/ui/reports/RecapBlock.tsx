import type { RecapStats } from '@/types/contract';

/** 晚间复盘：照实呈现数据，摆事实，不指责（§4.6 复盘不追责） */
export function RecapBlock({ stats }: { stats: RecapStats }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="text-sm font-medium text-muted-foreground">今日总结</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.items.map((item) => (
          <div key={item.label} className="rounded-xl bg-muted/60 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-0.5 text-sm font-medium">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
