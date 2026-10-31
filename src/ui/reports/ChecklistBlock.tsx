/**
 * 物品清单区块（dev-tasks B10 的考试日卡片）
 *
 * 这是对契约 v1.1 的一次**追加式扩展**（ReportBlock 增加一个 kind），不改变任何既有字段语义：
 *   contract.ts:   | { kind: 'checklist'; title: string; items: string[] }
 *   recipes.ts:    'exam-day' 配方末尾追加 'checklist'
 *   compose.ts:    在 switch 里加 case 'checklist'
 * 若评审不同意改契约，删掉这三处即可，报告仍能正常生成（只是少了这张卡）。
 */
export function ChecklistBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 text-muted-foreground">□</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">出门前扫一眼就够，别在考场门口才发现没带证件。</p>
    </section>
  );
}
