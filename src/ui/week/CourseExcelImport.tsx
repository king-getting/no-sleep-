import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { addCourse } from '@/data/store/courses';
import { fmtMin } from '@/types/contract';
import { newId, parseCourseExcel } from '@/lib/courseExcel';
import type { CourseInput, ParseResult } from '@/lib/courseExcel';

const WEEK_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const ACCEPT = '.xlsx,.xls,.csv';

/**
 * 课表 Excel 导入（按钮 + 文件选择 + 解析预览 + 确认写入）
 *
 * 两种用法：
 * - 周历页：不传 onParsed，确认后组件自己写库（addCourse）并回调 onImported
 * - 建档流程：传 onParsed，组件只解析预览，写库时机由建档的「完成」统一处理
 */
export default function CourseExcelImport({
  onParsed,
  onImported,
}: {
  onParsed?: (courses: CourseInput[]) => void;
  onImported?: (count: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    setFileName(file.name);
    setBusy(true);
    try {
      const result = parseCourseExcel(file);
      setParsed(await result);
    } catch (err) {
      setParsed({ courses: [], errors: [`读文件失败：${err instanceof Error ? err.message : String(err)}`], duplicates: 0 });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!parsed || parsed.courses.length === 0) return;
    if (onParsed) {
      onParsed(parsed.courses);
      return;
    }
    setBusy(true);
    try {
      for (const c of parsed.courses) await addCourse({ ...c, id: newId() });
      toast.success(`已导入 ${parsed.courses.length} 门课`, {
        description:
          parsed.errors.length > 0 ? `${parsed.errors.length} 行没导入，见上方提示` : '课表已更新，报告会立刻跟着变。',
      });
      setParsed(null);
      setFileName('');
      onImported?.(parsed.courses.length);
    } catch (err) {
      toast.error('导入失败', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const preview = parsed?.courses.slice(0, 6) ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
          {busy ? '解析中…' : fileName ? '重新选择文件' : '从 Excel 导入'}
        </Button>
        {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
      </div>

      {!fileName && !parsed && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          表格第一行放表头：<span className="font-medium">课程名 · 星期 · 开始 · 结束</span>（必填），教师 · 地点（可选）。
          时间写 08:00 这种格式；星期写 1–7 或 周一~周日。
        </p>
      )}

      {parsed && (
        <div className="rounded-xl border bg-muted/30 p-3 text-xs">
          <p className="font-medium">
            识别出 {parsed.courses.length} 门课
            {parsed.duplicates > 0 ? `（另有 ${parsed.duplicates} 行完全重复，已合并）` : ''}
            {parsed.errors.length > 0 ? `，${parsed.errors.length} 行有问题未导入` : ''}
          </p>
          {preview.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
              {preview.map((c, i) => (
                <li key={i}>
                  {WEEK_LABEL[c.dayOfWeek - 1]} {fmtMin(c.startMin)}–{fmtMin(c.endMin)} · {c.name}
                  {c.location ? ` · ${c.location}` : ''}
                </li>
              ))}
              {parsed.courses.length > preview.length && <li>…还有 {parsed.courses.length - preview.length} 门</li>}
            </ul>
          )}
          {parsed.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-destructive">
              {parsed.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {parsed.errors.length > 5 && <li>…还有 {parsed.errors.length - 5} 条</li>}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={parsed.courses.length === 0 || busy} onClick={() => void confirm()}>
              <Upload className="mr-1 h-3.5 w-3.5" />
              {onParsed ? `用这 ${parsed.courses.length} 门课` : `确认导入 ${parsed.courses.length} 门课`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setParsed(null); setFileName(''); }}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
