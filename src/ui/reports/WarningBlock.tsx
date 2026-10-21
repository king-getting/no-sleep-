import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { AgentId } from '@/types/contract';

export function WarningBlock({ text, agentId }: { text: string; agentId: AgentId }) {
  const meta = AGENT_META[agentId];
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/20">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p>
        {text}
        <span className={cn('ml-2 text-xs', meta.color)}>—— {meta.name} Agent</span>
      </p>
    </div>
  );
}
