import { Sunrise } from 'lucide-react';

/** 明日预告：早八预警 / 天气 / 要带的东西 */
export function PreviewBlock({ items }: { items: string[] }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Sunrise className="h-4 w-4" />
        明日预告
      </h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
