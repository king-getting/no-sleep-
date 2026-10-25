import { useState } from 'react';
import { Check, Minus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OptionCardView } from '@/ui/cards/OptionCardView';
import { MISS_REASON_OPTIONS } from '@/types/contract';
import type { Suggestion } from '@/types/contract';

/**
 * 建议区：以选项卡呈现，不替用户决定（§4.4）
 * 晚间闭环（§4.6/§4.7）：右上角「做了 / 没做」一键标记，措辞中性，不做红叉式追责。
 * §4.7 问「为什么」不问「怎么办」：点「没做」先问原因（起晚了/不饿/没时间/忘了），
 * 原因交给编排器换成次日更轻的选项卡；任何主题可一键「不再追问」。
 */
export function SuggestionGroupBlock({
  suggestion,
  pickedOptionId,
  marked,
  reason,
  noAsked,
  onPick,
  onMark,
  onNoAsk,
}: {
  suggestion: Suggestion;
  pickedOptionId?: string;
  /** 本次会话内该建议的标记结果：true=做了，false=没做 */
  marked?: boolean;
  /** 已记录的「没做」归因，展示在「已记录」徽标里 */
  reason?: string;
  /** 用户选过「不再追问」：整个闭环入口都不出现 */
  noAsked?: boolean;
  onPick?: (optionId: string) => void;
  onMark?: (done: boolean, reason?: string) => void;
  onNoAsk?: () => void;
}) {
  const [askingReason, setAskingReason] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 shrink-0 text-accent-foreground" />
          <span className="whitespace-nowrap">{suggestion.topic}</span>
          {/* 375px 上这行提示会把「主题」和右侧「做了/没做」挤成两行，小屏隐藏，桌面保留 */}
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">给选项，不替你决定</span>
        </h3>

        {onMark && !noAsked && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {marked === undefined && !askingReason ? (
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
                  onClick={() => setAskingReason(true)}
                >
                  <Minus className="mr-0.5 h-3 w-3" /> 没做
                </Button>
              </>
            ) : marked === undefined && askingReason ? (
              // §4.7：问「为什么」，不问「怎么办」。归因不是审讯，是帮明天扫清障碍
              <span className="flex flex-wrap items-center justify-end gap-1">
                <span className="text-[11px] text-muted-foreground/70">卡在哪了？</span>
                {MISS_REASON_OPTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    onClick={() => onMark(false, r)}
                  >
                    {r}
                  </button>
                ))}
                <button type="button" className="text-[11px] text-muted-foreground/60 underline decoration-dotted underline-offset-2 hover:text-foreground" onClick={() => onMark(false)}>
                  不填原因
                </button>
              </span>
            ) : (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  marked ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                已记录 · {marked ? '做了' : `没做${reason ? `（${reason}）` : ''}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 「不再追问」藏在归因行里：能发现（在问原因时出现），但不会误触 */}
      {askingReason && marked === undefined && onNoAsk && (
        <p className="-mt-1 text-right">
          <button
            type="button"
            className="text-[11px] text-muted-foreground/50 underline decoration-dotted underline-offset-2 hover:text-foreground"
            onClick={() => {
              setAskingReason(false);
              onNoAsk();
            }}
          >
            这个主题以后不再追问
          </button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
