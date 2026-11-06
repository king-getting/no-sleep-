import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIRECTION_META } from '@/ui/directionMeta';
import type { DirectionId } from '@/types/contract';

export function WarningBlock({ text, directionId }: { text: string; directionId: DirectionId }) {
  const meta = DIRECTION_META[directionId];
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/20">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p>
        {text}
        <span className={cn('ml-2 text-xs', meta.color)}>—— {meta.name}视角</span>
      </p>
    </div>
  );
}
