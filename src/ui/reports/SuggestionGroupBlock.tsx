import { Sparkles } from 'lucide-react';
import { OptionCardView } from '@/ui/cards/OptionCardView';
import type { Suggestion } from '@/types/contract';

/** 建议区：以选项卡呈现，不替用户决定（§4.4） */
export function SuggestionGroupBlock({
  suggestion,
  pickedOptionId,
  onPick,
}: {
  suggestion: Suggestion;
  pickedOptionId?: string;
  onPick?: (optionId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 font-medium">
        <Sparkles className="h-4 w-4 text-accent-foreground" />
        {suggestion.topic}
        <span className="text-xs font-normal text-muted-foreground">给选项，不替你决定</span>
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suggestion.options.map((option) => (
          <OptionCardView
            key={option.id}
            option={option}
            picked={pickedOptionId === option.id}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}
