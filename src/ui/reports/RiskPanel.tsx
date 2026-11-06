import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIRECTION_META } from '@/ui/directionMeta';
import type { DirectionId } from '@/types/contract';

/**
 * 风险项面板（左侧栏）
 *
 * 原先它在报告正文里，9 条连排会把右列顶得很长——真正要看的选项卡被推到两屏之外。
 * 挪到左栏后：右列只留「概览 + 选项卡 + 冲突 + 总结」，风险全程可见、可滚。
 */
export function RiskPanel({ items }: { items: { text: string; directionId: DirectionId }[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        <h3 className="text-[13px] font-medium">风险项</h3>
        <span className="text-[11px] text-muted-foreground">{items.length} 条</span>
      </div>
      <ul className="divide-y">
        {items.map((item, i) => {
          const meta = DIRECTION_META[item.directionId];
          return (
            <li key={i} className="flex items-start gap-2 px-3.5 py-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/80" />
              <p className="min-w-0 flex-1 text-[12px] leading-relaxed">{item.text}</p>
              <span className={cn('mt-0.5 shrink-0 text-[10px]', meta.color)}>{meta.name}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
