import { Badge } from '@/components/ui/badge';
import type { AgentId, Report, ReportBlock } from '@/types/contract';
import { ConflictCardView } from '@/ui/cards/ConflictCardView';
import { ChecklistBlock } from './ChecklistBlock';
import { OverviewBlock } from './OverviewBlock';
import { PreviewBlock } from './PreviewBlock';
import { RecapBlock } from './RecapBlock';
import { SuggestionGroupBlock } from './SuggestionGroupBlock';
import { WarningListBlock } from './WarningListBlock';

const REPORT_TITLE: Record<Report['type'], string> = {
  morning: '晨间报告',
  noon: '午间报告',
  evening: '晚间报告',
  'exam-day': '考试日报告',
  'exam-week': '冲刺报告',
  'exam-done': '考后小结',
};

/** 生存模式的三类报告：给标题挂个牌，不然观众不知道为什么突然变成「冲刺」 */
const SURVIVAL_TYPES: Report['type'][] = ['exam-day', 'exam-week', 'exam-done'];

function blockLabel(block: ReportBlock): string | null {
  switch (block.kind) {
    case 'overview':
      return '概览';
    case 'suggestionGroup':
      return block.suggestion.topic;
    case 'conflict':
      return block.conflict.topic;
    case 'warning':
      return '风险项';
    case 'recap':
      return '今日总结';
    case 'preview':
      return '明日预告';
    case 'checklist':
      return block.title;
    default:
      return null;
  }
}

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  // 尊重系统的「减少动态效果」：那类用户要的是不要位移，不是慢慢移
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/**
 * 报告渲染器：只按 Schema 渲染区块，不认识引擎内部任何实现。
 *
 * 动效只做两件事（见 docs/dev-tasks.md「动效口径」）：
 * 1. 区块**逐个**入场——让「4 个 Agent 汇总成一份报告」这件事在画面上成立；
 * 2. 换时段时整体淡入——演示时这个动作要连点三次，硬切会闪。
 * 所有动效都挂在 `motion-safe:` 下，系统开了「减少动态效果」就自动关掉。
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
  // 连续的 warning 合成一个「风险项」区块：6 条各占一张琥珀卡，整屏都是黄块，
  // 反而看不出哪条更要紧。分组后既省版面，也能在锚点里只占一格。
  const units: { key: number; block: ReportBlock; warnings?: { text: string; agentId: AgentId }[] }[] = [];
  report.blocks.forEach((block, i) => {
    const last = units.at(-1);
    if (block.kind === 'warning' && last?.warnings) {
      last.warnings.push({ text: block.text, agentId: block.agentId });
      return;
    }
    units.push(
      block.kind === 'warning'
        ? { key: i, block, warnings: [{ text: block.text, agentId: block.agentId }] }
        : { key: i, block },
    );
  });

  const navs = units
    .map((u, i) => ({ id: `block-${i}`, label: blockLabel(u.block) }))
    .filter((n) => n.label);
  const survival = SURVIVAL_TYPES.includes(report.type);
  const hasWarnings = report.blocks.some((b) => b.kind === 'warning');

  const renderBlock = (block: ReportBlock) => {
    switch (block.kind) {
      case 'overview':
        // 风险项已经有独立的列表卡（带条数），概览里再写一句「N 项需留意」是重复
        return <OverviewBlock items={block.items} hideLabels={hasWarnings ? ['风险项'] : undefined} />;
      case 'suggestionGroup':
        return (
          <SuggestionGroupBlock
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
            conflict={block.conflict}
            resolved={resolutions[block.conflict.id]}
            onResolve={onResolve ? (choice) => onResolve(block.conflict.id, block.conflict.topic, choice) : undefined}
          />
        );
      case 'warning':
        return <WarningListBlock items={[{ text: block.text, agentId: block.agentId }]} />;
      case 'recap':
        return <RecapBlock stats={block.stats} />;
      case 'preview':
        return <PreviewBlock items={block.items} />;
      case 'checklist':
        return <ChecklistBlock title={block.title} items={block.items} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3.5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-xl font-semibold">{REPORT_TITLE[report.type]}</h2>
        {survival && (
          <Badge variant="outline" className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-400">
            生存模式
          </Badge>
        )}
        <time className="text-xs text-muted-foreground">
          生成于 {new Date(report.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </time>
      </header>

      {/* 长报告给一排锚点：演示时不用一直滚，也不用背顺序 */}
      {navs.length > 2 && (
        <nav aria-label="报告区块" className="-mt-1 flex flex-wrap gap-1.5">
          {navs.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => jumpTo(n.id)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {n.label}
            </button>
          ))}
        </nav>
      )}

      {/* key 换掉时整体重淡入一次：切时段、重跑编排都走这里 */}
      <div
        key={new Date(report.generatedAt).getTime()}
        className="space-y-3.5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      >
        {units.map((u, i) => (
          <div
            key={u.key}
            id={`block-${i}`}
            className="scroll-mt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-300"
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
          >
            {u.warnings ? <WarningListBlock items={u.warnings} /> : renderBlock(u.block)}
          </div>
        ))}
      </div>
    </div>
  );
}
