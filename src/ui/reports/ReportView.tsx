import type { Report } from '@/types/contract';
import { ConflictCardView } from '@/ui/cards/ConflictCardView';
import { OverviewBlock } from './OverviewBlock';
import { PreviewBlock } from './PreviewBlock';
import { RecapBlock } from './RecapBlock';
import { SuggestionGroupBlock } from './SuggestionGroupBlock';
import { WarningBlock } from './WarningBlock';

const REPORT_TITLE: Record<Report['type'], string> = {
  morning: '晨间报告',
  noon: '午间报告',
  evening: '晚间报告',
  'exam-day': '考试日报告',
  'exam-week': '冲刺报告',
};

/**
 * 报告渲染器：只按 Schema 渲染区块，不认识引擎内部任何实现。
 */
export function ReportView({
  report,
  picks,
  resolutions,
  marks,
  onPick,
  onResolve,
  onMark,
}: {
  report: Report;
  picks: Record<string, string>; // suggestionId -> optionId
  resolutions: Record<string, 'A' | 'B'>; // conflictId -> choice
  /** 晚间闭环：suggestionId -> 是否做了 */
  marks?: Record<string, boolean>;
  onPick?: (suggestionId: string, optionId: string, topic: string) => void;
  onResolve?: (conflictId: string, topic: string, choice: 'A' | 'B') => void;
  /** 晚间闭环：做了 / 没做 */
  onMark?: (suggestionId: string, topic: string, done: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <header className="flex items-baseline gap-3">
        <h2 className="font-serif text-xl font-semibold">{REPORT_TITLE[report.type]}</h2>
        <time className="text-xs text-muted-foreground">
          生成于 {new Date(report.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </time>
      </header>

      {report.blocks.map((block, i) => {
        switch (block.kind) {
          case 'overview':
            return <OverviewBlock key={i} items={block.items} />;
          case 'suggestionGroup':
            return (
              <SuggestionGroupBlock
                key={i}
                suggestion={block.suggestion}
                pickedOptionId={picks[block.suggestion.id]}
                marked={marks?.[block.suggestion.id]}
                onPick={onPick ? (optionId) => onPick(block.suggestion.id, optionId, block.suggestion.topic) : undefined}
                onMark={onMark ? (done) => onMark(block.suggestion.id, block.suggestion.topic, done) : undefined}
              />
            );
          case 'conflict':
            return (
              <ConflictCardView
                key={i}
                conflict={block.conflict}
                resolved={resolutions[block.conflict.id]}
                onResolve={onResolve ? (choice) => onResolve(block.conflict.id, block.conflict.topic, choice) : undefined}
              />
            );
          case 'warning':
            return <WarningBlock key={i} text={block.text} agentId={block.agentId} />;
          case 'recap':
            return <RecapBlock key={i} stats={block.stats} />;
          case 'preview':
            return <PreviewBlock key={i} items={block.items} />;
        }
      })}
    </div>
  );
}
