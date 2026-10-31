import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, Clock, MapPin, Pencil, Trash2, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtMin } from '@/types/contract';
import type { Course } from '@/types/contract';

/**
 * 课表单元格的「点击」面板（B3 增强）
 *
 * - 点课程 → 详情（时间 / 地点 / 教师 / 时长 + 早八、压午休提示），可编辑或删除
 * - 点空白 → 新建，日期用该列，开始时间用点中的位置（吸附到 5 分钟）
 *
 * 不引入 Dialog 依赖，自己做一个底部抽屉（小屏贴底、桌面居中）：
 * 点击遮罩关闭、Esc 关闭、表单校验在本地完成、保存后由父组件刷新数据。
 */

const WEEK_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export type CourseDraft = {
  /** add = 新建，edit = 改已有 */
  mode: 'add' | 'edit';
  /** 初始值；新建时只用到 dayOfWeek / startMin / endMin */
  course: Course;
  /** 同一天的其他课，用来做时间冲突提示（不阻止保存） */
  siblings: Course[];
};

function toHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toMin(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

function overlaps(a: { startMin: number; endMin: number }, b: Course): boolean {
  return a.startMin < b.endMin && a.endMin > b.startMin;
}

export function CourseSheet({
  draft,
  onClose,
  onSave,
  onDelete,
}: {
  draft: CourseDraft;
  onClose: () => void;
  onSave: (course: Course, isNew: boolean) => void;
  onDelete: (course: Course) => void;
}) {
  const [mode, setMode] = useState<'view' | 'form'>(draft.mode === 'add' ? 'form' : 'view');
  const [name, setName] = useState(draft.course.name);
  const [teacher, setTeacher] = useState(draft.course.teacher ?? '');
  const [location, setLocation] = useState(draft.course.location);
  const [dow, setDow] = useState<number>(draft.course.dayOfWeek);
  const [start, setStart] = useState(toHHMM(draft.course.startMin));
  const [end, setEnd] = useState(toHHMM(draft.course.endMin));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode === 'form') nameRef.current?.focus();
  }, [mode]);

  const startMin = toMin(start);
  const endMin = toMin(end);

  const clash = useMemo(() => {
    if (startMin === null || endMin === null || endMin <= startMin) return [];
    return draft.siblings.filter((c) => overlaps({ startMin, endMin }, c));
  }, [draft.siblings, startMin, endMin]);

  const submit = () => {
    if (!name.trim()) return setError('课程名不能为空');
    if (!location.trim()) return setError('地点不能为空——报告里要按地点算通勤');
    if (startMin === null || endMin === null) return setError('时间格式不对');
    if (endMin <= startMin) return setError('下课时间要晚于上课时间');
    if (endMin - startMin < 20) return setError('一节课至少 20 分钟');
    setError(null);
    onSave(
      {
        ...draft.course,
        name: name.trim(),
        teacher: teacher.trim() || undefined,
        location: location.trim(),
        dayOfWeek: dow as Course['dayOfWeek'],
        startMin,
        endMin,
      },
      draft.mode === 'add',
    );
  };

  const isNew = draft.mode === 'add';
  const course = draft.course;
  const tags: string[] = [];
  if (course.startMin <= 480) tags.push('早八');
  if (course.startMin < 13 * 60 && course.endMin > 11 * 60 + 30) tags.push('压午休');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-t-2xl border bg-background p-4 shadow-lg sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? '添加课程' : '课程详情'}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">{isNew ? '加一门课' : mode === 'form' ? '改这门课' : '课程详情'}</h2>
            {isNew && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {WEEK_LABEL[dow - 1]} · {start} 开始
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'view' ? (
          <>
            <p className="text-lg font-medium">{course.name}</p>
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="rounded border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-[11px] text-destructive">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <dl className="mt-3 grid grid-cols-[72px_1fr] gap-y-2 text-sm">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                时间
              </dt>
              <dd>
                {WEEK_LABEL[course.dayOfWeek - 1]} {fmtMin(course.startMin)}–{fmtMin(course.endMin)}
                <span className="text-muted-foreground">（{durationText(course.endMin - course.startMin)}）</span>
              </dd>
              <dt className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                地点
              </dt>
              <dd>{course.location}</dd>
              <dt className="flex items-center gap-1 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                教师
              </dt>
              <dd>{course.teacher || <span className="text-muted-foreground">未填</span>}</dd>
            </dl>

            {confirmDelete ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm">删掉「{course.name}」？报告里的空档和冲突会跟着变。</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => onDelete(course)}>
                    确认删除
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    先不删
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => setMode('form')}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2.5">
            <label className="block text-xs text-muted-foreground">
              课程名
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：数据结构"
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block text-xs text-muted-foreground">
                开始
                <input
                  type="time"
                  step={300}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                结束
                <input
                  type="time"
                  step={300}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">
              星期
              <select
                value={dow}
                onChange={(e) => setDow(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {WEEK_LABEL.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block text-xs text-muted-foreground">
                地点
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="例如：九号楼 9402"
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                教师（可不填）
                <input
                  value={teacher}
                  onChange={(e) => setTeacher(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </label>
            </div>

            {clash.length > 0 && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                这个时段和「{clash.map((c) => c.name).join('」「')}」重叠了。可以照存，但两门课会被画在同一格里。
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={submit}>
                <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
                保存
              </Button>
              <Button size="sm" variant="ghost" onClick={isNew ? onClose : () => setMode('view')}>
                取消
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
