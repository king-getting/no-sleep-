import { useState } from 'react';
import { Check, ChevronDown, Clock, Coins, Salad } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { nutritionLabel, nutritionTip } from '@/lib/nutrition';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { OptionCard } from '@/types/contract';

/**
 * 选项卡（契约 §2）：每张卡标注三要素——花多少钱 / 花多少时间 / 适不适合现在的你，
 * 附「优势 / 代价 / 可能影响」，「为什么」可展开查看各 Agent 依据。
 */
export function OptionCardView({
  option,
  picked,
  dimmed,
  onPick,
}: {
  option: OptionCard;
  picked?: boolean;
  /** 同组里已经选了别人：这张退到背景里，但仍然可点（随时能改主意） */
  dimmed?: boolean;
  onPick?: (optionId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 shadow-xs transition-all duration-200',
        'motion-safe:active:scale-[0.995]',
        picked && 'border-primary bg-primary/5 ring-1 ring-primary/20',
        dimmed && 'opacity-70 hover:opacity-100',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{option.title}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {option.cost.money !== undefined && (
              <Badge variant="secondary" className="gap-1 font-normal">
                <Coins className="h-3 w-3" /> ¥{option.cost.money}
              </Badge>
            )}
            {option.cost.timeMin !== undefined && (
              <Badge variant="secondary" className="gap-1 font-normal">
                <Clock className="h-3 w-3" /> {option.cost.timeMin} 分钟
              </Badge>
            )}
          </div>
        </div>
        {onPick && (
          <Button
            size="sm"
            variant={picked ? 'default' : 'outline'}
            className="shrink-0 transition-transform motion-safe:active:scale-95"
            onClick={() => onPick(option.id)}
          >
            {picked ? (
              <>
                <Check className="mr-1 h-3.5 w-3.5" /> 已选
              </>
            ) : (
              '选这个'
            )}
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        {option.nutrition && (
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Salad className="h-3 w-3" />
              这一餐
            </span>
            <span className="text-foreground/80">{nutritionLabel(option.nutrition)}</span>
            {nutritionTip(option.nutrition) && <span>· {nutritionTip(option.nutrition)}</span>}
          </p>
        )}
        {option.pros.map((t) => (
          <p key={t} className="text-foreground/90">
            <span className="mr-1.5 text-primary">优势</span>
            {t}
          </p>
        ))}
        {option.cons.map((t) => (
          <p key={t} className="text-muted-foreground">
            <span className="mr-1.5 text-muted-foreground/70">代价</span>
            {t}
          </p>
        ))}
        {option.impacts.map((impact) => (
          <p key={impact.text} className="text-muted-foreground">
            <span className="mr-1.5 text-accent-foreground/80">{impact.horizon === 'short' ? '短期影响' : '长期影响'}</span>
            {impact.text}
          </p>
        ))}
      </div>

      {option.evidences.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            为什么推荐这个
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5 border-l-2 border-primary/30 pl-3">
            {option.evidences.map((ev, i) => {
              const meta = AGENT_META[ev.agentId];
              return (
                <p key={i} className="text-xs text-muted-foreground">
                  <span className={cn('mr-1.5 inline-flex items-center gap-1 font-medium', meta.color)}>
                    <span className={cn('inline-block h-1.5 w-1.5 rounded-full', meta.bg)} />
                    {meta.name} Agent
                  </span>
                  {ev.text}
                </p>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
