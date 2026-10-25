import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { AgentId } from '@/types/contract';

/**
 * 风险项列表：把连续的多条 warning 收进一张卡里。
 * 以前每条 warning 都是一张琥珀色卡片，6 条连排时整屏都是黄块，
 * 反而看不出哪条更要紧——收成列表后，注意力落在文字上，Agent 归属退到右侧。
 */
export function WarningListBlock({ items }: { items: { text: string; agentId: AgentId }[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-medium">风险项</h3>
        <span className="text-xs text-muted-foreground">{items.length} 条</span>
      </div>
      <ul className="divide-y">
        {items.map((item, i) => {
          const meta = AGENT_META[item.agentId];
          return (
            <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/80" />
              <p className="min-w-0 flex-1 text-sm leading-relaxed">{item.text}</p>
              <span className={cn('mt-0.5 hidden shrink-0 text-[11px] sm:inline', meta.color)}>{meta.name}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
