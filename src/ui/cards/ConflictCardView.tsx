import { Fragment } from 'react';
import { Clock, Coins, Info, Salad, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fmtDuration, fmtMoney } from '@/lib/format';
import { nutritionLabel, nutritionTip } from '@/lib/nutrition';
import { cn } from '@/lib/utils';
import { AGENT_META } from '@/ui/agentMeta';
import type { ConflictCard, ConflictPlan } from '@/types/contract';

function PlanView({
  plan,
  side,
  chosen,
  dimmed,
  onChoose,
}: {
  plan: ConflictPlan;
  side: 'A' | 'B';
  chosen: boolean;
  dimmed?: boolean;
  onChoose?: () => void;
}) {
  const meta = AGENT_META[plan.agentId];
  return (
    <div
      className={cn(
        'min-w-0 flex-1 basis-0 rounded-xl border bg-card p-4 transition-all duration-300',
        chosen && 'border-primary bg-primary/5',
        // 只有在「已经做过选择」时才把另一边压暗；没选的时候两侧一样重，谁也别装成默认答案
        dimmed && 'opacity-60 hover:opacity-100',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={cn('gap-1.5 font-normal', meta.color)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', meta.bg)} />
          {meta.name} Agent 主张
        </Badge>
        {onChoose && (
          <Button size="sm" variant={chosen ? 'default' : 'outline'} onClick={onChoose}>
            {chosen ? '已选' : `选方案 ${side}`}
          </Button>
        )}
      </div>
      <p className="mt-2 text-[13.5px] font-medium leading-snug">{plan.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {plan.when && (
          <Badge variant="default" className="h-5 gap-1 bg-accent px-1.5 text-[11px] font-normal text-accent-foreground">
            <Clock className="h-2.5 w-2.5" />
            {plan.when}
          </Badge>
        )}
        {plan.cost.money !== undefined && (
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[11px] font-normal">
            <Coins className="h-2.5 w-2.5" />
            {fmtMoney(plan.cost.money)}
          </Badge>
        )}
        {plan.cost.timeMin !== undefined && (
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[11px] font-normal">
            <Clock className="h-2.5 w-2.5" />
            {fmtDuration(plan.cost.timeMin)}
          </Badge>
        )}
      </div>
      {plan.nutrition && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Salad className="h-3 w-3" />
            这一餐
          </span>
          <span className="text-foreground/80">{nutritionLabel(plan.nutrition)}</span>
          {nutritionTip(plan.nutrition) && <span>· {nutritionTip(plan.nutrition)}</span>}
        </p>
      )}
      <div className="mt-2 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px] leading-relaxed">
        {plan.pros.map((t) => (
          <Fragment key={`p-${t}`}>
            <span className="text-primary/80">优势</span>
            <span className="text-foreground/90">{t}</span>
          </Fragment>
        ))}
        {plan.cons.map((t) => (
          <Fragment key={`c-${t}`}>
            <span className="text-muted-foreground/70">代价</span>
            <span className="text-muted-foreground">{t}</span>
          </Fragment>
        ))}
        {plan.impacts.map((i) => (
          <Fragment key={i.text}>
            <span className="text-muted-foreground/60">{i.horizon === 'short' ? '短期' : '长期'}</span>
            <span className="text-muted-foreground">{i.text}</span>
          </Fragment>
        ))}
      </div>
      {plan.fallback && (
        <p className="mt-1.5 flex items-start gap-1 text-[11.5px] text-muted-foreground/80">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>不选的话：{plan.fallback}</span>
        </p>
      )}
      <div className="mt-2 border-t pt-1.5 text-[11px] text-muted-foreground">
        依据：{plan.evidences.map((e) => e.text).join('；')}
      </div>
    </div>
  );
}

/**
 * 冲突卡（契约 §3 / 设计 §5.3）：真冲突显性化，两个方案各挂依据、代价与可能影响，用户拍板。
 */
export function ConflictCardView({
  conflict,
  resolved,
  onResolve,
}: {
  conflict: ConflictCard;
  resolved?: 'A' | 'B';
  onResolve?: (choice: 'A' | 'B') => void;
}) {
  // 上次裁决过的方案要真的高亮出来：只挂一句「已预填」的徽标、按钮却都是未选，等于骗人
  const chosenSide = resolved ?? conflict.presetChoice;
  return (
    <section className="rounded-2xl border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-950/20">
      <header className="flex flex-wrap items-center gap-2">
        <Scale className="h-4 w-4 text-amber-600" />
        <h3 className="font-medium">两个 Agent 意见不合，你来拍板</h3>
        <Badge variant="outline" className="font-normal">{conflict.topic}</Badge>
        <Badge variant="secondary" className="font-normal">{conflict.level}</Badge>
        {conflict.preset && (
          <Badge variant="secondary" className="font-normal">已按你上次的选择预填，可一键切换</Badge>
        )}
      </header>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <PlanView
          plan={conflict.planA}
          side="A"
          chosen={chosenSide === 'A'}
          dimmed={!!chosenSide && chosenSide !== 'A'}
          onChoose={onResolve ? () => onResolve('A') : undefined}
        />
        <PlanView
          plan={conflict.planB}
          side="B"
          chosen={chosenSide === 'B'}
          dimmed={!!chosenSide && chosenSide !== 'B'}
          onChoose={onResolve ? () => onResolve('B') : undefined}
        />
      </div>
    </section>
  );
}
