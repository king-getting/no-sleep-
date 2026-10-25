import { Fragment, useState } from 'react';
import { Check, ChevronDown, Clock, Coins, Gauge, Info, Salad } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { fmtDuration, fmtEffort, fmtMoney } from '@/lib/format';
import { nutritionLabel, nutritionTip } from '@/lib/nutrition';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { OptionCard } from '@/types/contract';

/**
 * 选项卡（契约 §2，v2.0 收紧）：
 * 一行 chip 交代「什么时候 / 花多少 / 费不费神」，标题写动作与取舍，正文只留 2 条优势 + 2 条代价 + 一条短期影响。
 * 整张卡是单选项：点哪里都能选，右上角一个圆圈表示选中状态——原来每张卡一个「选这个」按钮，
 * 三张并排就是三个按钮抢注意力。
 */
export function OptionCardView({
  option,
  picked,
  dimmed,
  onPick,
}: {
  option: OptionCard;
  picked?: boolean;
  /** 同组里已经选了别人：压暗到 80%，但仍然可点（随时能改主意） */
  dimmed?: boolean;
  onPick?: (optionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = () => onPick?.(option.id);
  const longImpacts = option.impacts.filter((i) => i.horizon === 'long');
  const shortImpacts = option.impacts.filter((i) => i.horizon === 'short');

  const chips = [
    option.when && { key: 'when', icon: Clock, text: option.when, tone: 'strong' as const },
    option.cost.money !== undefined && { key: 'money', icon: Coins, text: fmtMoney(option.cost.money) },
    option.cost.timeMin !== undefined && { key: 'time', icon: Clock, text: fmtDuration(option.cost.timeMin) },
    option.cost.effort && { key: 'effort', icon: Gauge, text: fmtEffort(option.cost.effort) },
  ].filter(Boolean) as { key: string; icon: typeof Clock; text: string; tone?: 'strong' }[];

  return (
    <div
      role={onPick ? 'radio' : undefined}
      aria-checked={onPick ? !!picked : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={pick}
      onKeyDown={(e) => {
        if (!onPick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
      className={cn(
        'group relative rounded-xl border bg-card p-3 transition-colors',
        onPick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        picked ? 'border-primary/60 bg-primary/[0.04]' : 'border-border hover:border-foreground/25',
        dimmed && !picked && 'opacity-80 hover:opacity-100',
      )}
    >
      {/* 选中圆圈：占住右上角，替代原来的「选这个」按钮 */}
      {onPick && (
        <span
          aria-hidden
          className={cn(
            'absolute right-2.5 top-2.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border transition-colors',
            picked
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-transparent group-hover:border-foreground/30',
          )}
          style={{ width: 18, height: 18 }}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}

      <div className={cn('space-y-1', onPick && 'pr-6')}>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {chips.map(({ key, icon: Icon, text, tone }) => (
              <Badge
                key={key}
                variant={tone === 'strong' ? 'default' : 'secondary'}
                className={cn('h-5 gap-1 px-1.5 text-[11px] font-normal', tone === 'strong' && 'bg-accent text-accent-foreground')}
              >
                <Icon className="h-2.5 w-2.5" />
                {text}
              </Badge>
            ))}
          </div>
        )}

        <p className="text-[13.5px] font-medium leading-snug">{option.title}</p>
        {option.note && <p className="truncate text-[11.5px] text-muted-foreground">{option.note}</p>}
      </div>

      {option.nutrition && (
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Salad className="h-3 w-3" />
            这一餐
          </span>
          <span className="text-foreground/80">{nutritionLabel(option.nutrition)}</span>
          {nutritionTip(option.nutrition) && <span>· {nutritionTip(option.nutrition)}</span>}
        </p>
      )}

      {/* 定宽标签列：优势/代价/影响 的文字都从同一条竖线开始 */}
      <div className="mt-2 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px] leading-relaxed">
        {option.pros.map((t) => (
          <Fragment key={`pro-${t}`}>
            <span className="text-primary/80">优势</span>
            <span className="text-foreground/90">{t}</span>
          </Fragment>
        ))}
        {option.cons.map((t) => (
          <Fragment key={`con-${t}`}>
            <span className="text-muted-foreground/70">代价</span>
            <span className="text-muted-foreground">{t}</span>
          </Fragment>
        ))}
        {shortImpacts.map((impact) => (
          <Fragment key={`impact-${impact.text}`}>
            <span className="text-muted-foreground/60">短期</span>
            <span className="text-muted-foreground">{impact.text}</span>
          </Fragment>
        ))}
      </div>

      {option.fallback && (
        <p className="mt-1.5 flex items-start gap-1 text-[11.5px] text-muted-foreground/80">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>不选的话：{option.fallback}</span>
        </p>
      )}

      {(option.evidences.length > 0 || longImpacts.length > 0) && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-1.5">
          <CollapsibleTrigger
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-foreground"
          >
            为什么推荐这个
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-1 border-l-2 border-primary/25 pl-2.5">
            {longImpacts.map((impact) => (
              <p key={impact.text} className="text-[11.5px] text-muted-foreground">
                <span className="mr-1 font-medium">长期</span>
                {impact.text}
              </p>
            ))}
            {option.evidences.map((ev, i) => {
              const meta = AGENT_META[ev.agentId];
              return (
                <p key={`ev-${i}`} className="text-[11.5px] text-muted-foreground">
                  <span className={cn('mr-1 inline-flex items-center gap-1 font-medium', meta.color)}>
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
