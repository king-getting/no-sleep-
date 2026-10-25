import { Scale, Salad } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <p className="mt-2 font-medium">{plan.title}</p>
      {plan.nutrition && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Salad className="h-3 w-3" />
            这一餐
          </span>
          <span className="text-foreground/80">{nutritionLabel(plan.nutrition)}</span>
          {nutritionTip(plan.nutrition) && <span>· {nutritionTip(plan.nutrition)}</span>}
        </p>
      )}
      <div className="mt-2 space-y-1 text-sm">
        {plan.pros.map((t) => (
          <p key={t}><span className="mr-1.5 text-primary">优势</span>{t}</p>
        ))}
        {plan.cons.map((t) => (
          <p key={t} className="text-muted-foreground"><span className="mr-1.5">代价</span>{t}</p>
        ))}
        {plan.impacts.map((i) => (
          <p key={i.text} className="text-muted-foreground">
            <span className="mr-1.5">{i.horizon === 'short' ? '短期影响' : '长期影响'}</span>
            {i.text}
          </p>
        ))}
      </div>
      <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
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
