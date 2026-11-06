import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * 设置页的可折叠分组
 *
 * 手机上设置页太长，画像、模型接入、备份这些不是每天都动的块默认收起；
 * 用原生 <details>，不用 JS 状态，刷新后也不会跳。
 */
export default function Fold({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border bg-card" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}
