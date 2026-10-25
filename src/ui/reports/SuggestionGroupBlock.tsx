import { Check, Minus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OptionCardView } from '@/ui/cards/OptionCardView';
import type { Suggestion } from '@/types/contract';

/**
 * 建议区：以选项卡呈现，不替用户决定（§4.4）
 * 晚间闭环（§4.6/§4.7）：右上角「做了 / 没做」一键标记，措辞中性，不做红叉式追责。
 */
export function SuggestionGroupBlock({
  suggestion,
  pickedOptionId,
  marked,
  onPick,
  onMark,
}: {
  suggestion: Suggestion;
  pickedOptionId?: string;
  /** 本次会话内该建议的标记结果：true=做了，false=没做 */
  marked?: boolean;
  onPick?: (optionId: string) => void;
  onMark?: (done: boolean) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
          <span className="whitespace-nowrap">{suggestion.topic}</span>
          {/* 375px 上这行提示会把「主题」和右侧「做了/没做」挤成两行，小屏隐藏，桌面保留 */}
          <span className="hidden text-[11px] font-normal text-muted-foreground sm:inline">给选项，不替你决定</span>
        </h3>

        {onMark && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {marked === undefined ? (
              // 主操作是「选这个」。做没做是事后记账，所以压成安静的小字，
              // 别和卡片上的按钮抢注意力（演示时观众会同时看到两组按钮，容易读成两件事）
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px] font-normal text-muted-foreground/70 hover:text-foreground"
                  onClick={() => onMark(true)}
                >
                  <Check className="mr-0.5 h-3 w-3" /> 做了
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px] font-normal text-muted-foreground/70 hover:text-foreground"
                  onClick={() => onMark(false)}
                >
                  <Minus className="mr-0.5 h-3 w-3" /> 没做
                </Button>
              </>
            ) : (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  marked ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                已记录 · {marked ? '做了' : '没做'}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        className={`grid gap-2 sm:grid-cols-2 ${suggestion.options.length >= 3 ? 'lg:grid-cols-3' : ''}`}
      >
        {suggestion.options.map((option) => (
          <OptionCardView
            key={option.id}
            option={option}
            picked={pickedOptionId === option.id}
            dimmed={!!pickedOptionId && pickedOptionId !== option.id}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}
