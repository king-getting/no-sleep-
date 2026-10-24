import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CalendarPlus, ChevronDown, Clock3, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { addExam, deleteExam, listExams, updateExam } from '@/data/store/courses';
import { deleteReviewBlocksForExam } from '@/data/store/review';
import type { ExamItem } from '@/types/contract';

const MASTERY_LABELS = ['很陌生', '较薄弱', '一般', '较熟悉', '很有把握'];
const EXAM_DURATION_MS = 2 * 60 * 60 * 1000;

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(9, 0, 0, 0);
  return toLocalInput(date);
}

function examDateText(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待定';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function statusOf(item: ExamItem, now: number): { label: string; ended: boolean } {
  const at = new Date(item.at).getTime();
  if (Number.isNaN(at)) return { label: '时间待定', ended: false };
  if (item.kind === 'ddl') return at >= now ? { label: '待完成', ended: false } : { label: '已截止', ended: true };
  if (at > now) return { label: '未开始', ended: false };
  if (at + EXAM_DURATION_MS > now) return { label: '进行中', ended: false };
  return { label: '已结束', ended: true };
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `exam-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ExamSheet({
  exam,
  onClose,
  onSave,
}: {
  exam: ExamItem | null;
  onClose: () => void;
  onSave: (exam: ExamItem, isNew: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState(exam?.title ?? '');
  const [kind, setKind] = useState<ExamItem['kind']>(exam?.kind ?? 'exam');
  const [at, setAt] = useState(exam ? toLocalInput(new Date(exam.at)) : defaultAt());
  const [mastery, setMastery] = useState<ExamItem['mastery']>(exam?.mastery ?? 3);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError('请填写考试或事项名称');
    if (!at || Number.isNaN(new Date(at).getTime())) return setError('请选择有效的日期和时间');

    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          id: exam?.id ?? newId(),
          title: title.trim(),
          kind,
          at: new Date(at).toISOString(),
          mastery: kind === 'exam' ? mastery : undefined,
        },
        exam === null,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} role="presentation">
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border bg-background p-4 shadow-lg sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={exam ? '编辑考试或 DDL' : '新增考试或 DDL'}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{exam ? '编辑考试 / DDL' : '新增考试 / DDL'}</h2>
            <p className="mt-1 text-xs text-muted-foreground">保存到本机，报告和复习草案共用这份数据。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-xs font-medium text-muted-foreground">
            名称
            <input
              ref={nameRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：数据结构期末考试"
              maxLength={60}
              className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
            />
          </label>

          <fieldset>
            <legend className="text-xs font-medium text-muted-foreground">类型</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['exam', 'ddl'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                  className={`h-9 rounded-md border text-sm transition ${kind === value ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  {value === 'exam' ? '考试' : 'DDL / 截止事项'}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-xs font-medium text-muted-foreground">
            {kind === 'exam' ? '开考时间' : '截止时间'}
            <input
              type="datetime-local"
              value={at}
              onChange={(event) => setAt(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
            />
          </label>

          {kind === 'exam' && (
            <fieldset>
              <legend className="text-xs font-medium text-muted-foreground">掌握度自评</legend>
              <div className="mt-1.5 grid grid-cols-5 gap-1.5" aria-label="掌握度，1 最陌生，5 最有把握">
                {MASTERY_LABELS.map((label, index) => {
                  const value = (index + 1) as NonNullable<ExamItem['mastery']>;
                  return (
                    <button
                      key={label}
                      type="button"
                      title={label}
                      aria-label={`${value} 分：${label}`}
                      aria-pressed={mastery === value}
                      onClick={() => setMastery(value)}
                      className={`h-9 rounded-md border text-sm transition ${mastery === value ? 'border-primary bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {mastery}/5 · {MASTERY_LABELS[(mastery ?? 3) - 1]}。掌握度越低，重排时分配的复习时间越多。
              </p>
            </fieldset>
          )}

          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving}>
              <CalendarPlus className="mr-1.5 h-4 w-4" />
              {saving ? '保存中' : '保存'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ExamManager({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<ExamItem | null | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setExams(await listExams());
    } catch {
      toast.error('考试数据读取失败，请刷新后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (item: ExamItem, isNew: boolean) => {
    try {
      if (isNew) await addExam(item);
      else await updateExam(item.id, { title: item.title, kind: item.kind, at: item.at, mastery: item.mastery });
      await load();
      await onChanged?.();
      setDraft(undefined);
      toast.success(isNew ? '已添加' : '已保存修改', {
        description: item.kind === 'exam' ? '已有草案不会被覆盖，点「按考试重排」即可应用新的掌握度。' : '报告会在下次生成时使用新的截止时间。',
      });
    } catch {
      toast.error('保存失败，请重试');
    }
  };

  const remove = async (item: ExamItem) => {
    try {
      await deleteExam(item.id);
      const removedBlocks = await deleteReviewBlocksForExam(item.id);
      await load();
      await onChanged?.();
      setConfirmDeleteId(null);
      toast.success(`已删除「${item.title}」`, {
        description: removedBlocks > 0 ? `同时清理了 ${removedBlocks} 段关联复习草案。` : '没有关联的复习草案。',
      });
    } catch {
      toast.error('删除失败，请重试');
    }
  };

  const now = Date.now();
  const upcomingCount = exams.filter((item) => !statusOf(item, now).ended).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6 rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
          <span className="font-medium">考试与 DDL</span>
          {!loading && <Badge variant="secondary" className="font-normal">{upcomingCount} 项待处理</Badge>}
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <Button size="sm" variant="outline" onClick={() => { setOpen(true); setDraft(null); }}>
          <CalendarPlus className="mr-1 h-3.5 w-3.5" />
          新增
        </Button>
      </div>

      <CollapsibleContent>
        <div className="border-t px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            维护考试时间和掌握度；修改后手动重排，不会打断你当前的复习节奏。
          </p>
          {loading ? (
            <p className="py-5 text-center text-xs text-muted-foreground">正在读取本机考试…</p>
          ) : exams.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-7 text-center">
              <p className="text-sm font-medium">还没有考试或 DDL</p>
              <p className="mt-1 text-xs text-muted-foreground">先录入一项，再让复习计划和报告使用它。</p>
              <Button size="sm" className="mt-3" onClick={() => setDraft(null)}>新增第一项</Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {exams.map((item) => {
                const status = statusOf(item, now);
                return (
                  <li key={item.id} className="rounded-xl border bg-background p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-sm font-medium ${status.ended ? 'text-muted-foreground' : ''}`}>{item.title}</span>
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{item.kind === 'exam' ? '考试' : 'DDL'}</Badge>
                          <Badge variant={status.ended ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[10px] font-normal">{status.label}</Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{examDateText(item.at)}</span>
                          {item.kind === 'exam' && <span>掌握度 {item.mastery ?? '未评'}{item.mastery ? '/5' : ''}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDraft(item)} aria-label={`编辑 ${item.title}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setConfirmDeleteId(item.id)} aria-label={`删除 ${item.title}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {confirmDeleteId === item.id && (
                      <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                        <p className="text-xs leading-relaxed">确定删除「{item.title}」？关联复习草案也会一并清理。</p>
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="destructive" onClick={() => void remove(item)}>确认删除</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>取消</Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CollapsibleContent>

      {draft !== undefined && (
        <ExamSheet key={draft?.id ?? 'new'} exam={draft} onClose={() => setDraft(undefined)} onSave={save} />
      )}
    </Collapsible>
  );
}
