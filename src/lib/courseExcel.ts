import * as XLSX from 'xlsx';
import type { Course } from '@/types/contract';

/**
 * 课表 Excel 导入（补足 §4.9「课表导入」的手动录入路径）
 *
 * 约定：第一个工作表，第一行表头。识别列（中英文均可，模糊匹配）：
 *   必填：课程名(name) · 星期(day) · 开始(start) · 结束(end)
 *   可选：教师(teacher) · 地点/教室(location)
 *
 * 时间支持三种写法：'08:00' / '8:00' 字符串、Excel 时间格式（单元格序列值）、'0830'
 * 星期支持：1–7 / '周一'…'周日' / '星期一'…
 * 空行跳过；完全重复的行只算一次；无法解析的行带行号进 errors，不阻断其余行。
 */

export type CourseInput = Omit<Course, 'id'>;

export interface ParseResult {
  courses: CourseInput[];
  /** 「第 N 行：原因」 */
  errors: string[];
  /** 文件里被合并掉的完全重复行数 */
  duplicates: number;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ── 表头识别 ────────────────────────────────────────────────

type ColumnKey = 'name' | 'teacher' | 'location' | 'dayOfWeek' | 'startMin' | 'endMin';

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  name: ['课程名', '课程名称', '课程', 'name', 'course'],
  teacher: ['教师', '老师', 'teacher'],
  location: ['地点', '教室', '位置', 'location', 'room'],
  dayOfWeek: ['星期', '星期几', '周几', 'day', 'dow', 'weekday'],
  startMin: ['开始', '开始时间', 'start', 'begin', 'from'],
  endMin: ['结束', '结束时间', 'end', 'to'],
};

function normHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase();
}

function matchColumn(header: string): ColumnKey | null {
  for (const key of Object.keys(HEADER_ALIASES) as ColumnKey[]) {
    if (HEADER_ALIASES[key].some((alias) => header === alias.toLowerCase() || header.includes(alias.toLowerCase()))) {
      return key;
    }
  }
  return null;
}

// ── 单元格解析 ──────────────────────────────────────────────

/** 时间 → 当日分钟数；无法解析返回 null。支持 '08:00'、Excel 序列值（0–1 的小数）、'0830'、'830' */
export function parseMinute(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 1) {
      // Excel 时间：1 = 一整天
      return Math.round(value * 24 * 60);
    }
    const compact = Math.round(value); // 830 → 08:30
    if (compact >= 0 && compact <= 2400) {
      const h = Math.floor(compact / 100);
      const m = compact % 100;
      if (h <= 24 && m < 60) return h * 60 + m;
    }
    return null;
  }
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\s*[:：.]\s*(\d{1,2})/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 24 && min < 60) return h * 60 + min;
    return null;
  }
  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const compact = Number(m[1]);
    const h = Math.floor(compact / 100);
    const min = compact % 100;
    if (h <= 24 && min < 60) return h * 60 + min;
  }
  return null;
}

/** 星期 → 1–7；无法解析返回 null */
export function parseDayOfWeek(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1 && value <= 7 ? Math.round(value) : null;
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  // 中文数字：周一~周六 / 星期日|天
  const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const cn = s.match(/周|星期/);
  if (cn) {
    const rest = s.slice(cn.index! + cn[0].length);
    if (rest[0] in CN_NUM) return CN_NUM[rest[0]];
    if (rest[0] === '日' || rest[0] === '天') return 7;
  }
  const digit = s.match(/([1-7])/);
  if (digit) return Number(digit[1]);
  if (s.includes('日') || s.toLowerCase().includes('sun')) return 7;
  return null;
}

// ── 主流程 ──────────────────────────────────────────────────

const REQUIRED: ColumnKey[] = ['name', 'dayOfWeek', 'startMin', 'endMin'];

export function parseCourseRows(rows: unknown[][]): ParseResult {
  const courses: CourseInput[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  if (rows.length === 0) {
    return { courses, errors: ['文件是空的：需要表头 + 至少一行课程'], duplicates };
  }

  // 第一行是表头；找不到任何可识别列时也按表头处理并给出提示
  const headerCells = rows[0].map(normHeader);
  const colMap = new Map<number, ColumnKey>();
  headerCells.forEach((h, idx) => {
    const key = matchColumn(h);
    if (key && ![...colMap.values()].includes(key)) colMap.set(idx, key);
  });

  const found = new Set(colMap.values());
  const missing = REQUIRED.filter((k) => !found.has(k));
  if (missing.length > 0) {
    const label: Record<ColumnKey, string> = {
      name: '课程名',
      teacher: '教师',
      location: '地点',
      dayOfWeek: '星期',
      startMin: '开始',
      endMin: '结束',
    };
    return {
      courses,
      errors: [
        `表头没认出来（缺少：${missing.map((k) => label[k]).join('、')}）。` +
          `第一行需要包含：课程名 / 星期 / 开始 / 结束，可选：教师 / 地点。`,
      ],
      duplicates,
    };
  }

  rows.slice(1).forEach((row, i) => {
    const excelRow = i + 2; // 人类可读的行号（含表头）
    const cell = (key: ColumnKey): unknown => {
      for (const [idx, k] of colMap) if (k === key) return row[idx];
      return undefined;
    };

    const rawName = String(cell('name') ?? '').trim();
    const rawDay = cell('dayOfWeek');
    const rawStart = cell('startMin');
    const rawEnd = cell('endMin');

    // 整行空白：直接跳过，不算错误
    if (!rawName && (rawDay === undefined || rawDay === '') && (rawStart === undefined || rawStart === '') && (rawEnd === undefined || rawEnd === '')) {
      return;
    }

    if (!rawName) {
      errors.push(`第 ${excelRow} 行：课程名是空的`);
      return;
    }
    const day = parseDayOfWeek(rawDay);
    if (day === null) {
      errors.push(`第 ${excelRow} 行：星期「${String(rawDay)}」认不出来（写 1–7 或 周一~周日）`);
      return;
    }
    const start = parseMinute(rawStart);
    if (start === null) {
      errors.push(`第 ${excelRow} 行：开始时间「${String(rawStart)}」认不出来（写 08:00 这种格式）`);
      return;
    }
    const end = parseMinute(rawEnd);
    if (end === null) {
      errors.push(`第 ${excelRow} 行：结束时间「${String(rawEnd)}」认不出来（写 09:40 这种格式）`);
      return;
    }
    if (start >= end) {
      errors.push(`第 ${excelRow} 行：${rawName} 开始时间晚于结束时间`);
      return;
    }
    if (end > 24 * 60) {
      errors.push(`第 ${excelRow} 行：${rawName} 结束时间超过 24:00`);
      return;
    }

    // 吸附到 5 分钟，和周历页手动画块的行为一致
    const snap = (v: number) => Math.round(v / 5) * 5;
    const key = `${rawName}|${day}|${snap(start)}|${snap(end)}`;
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);

    courses.push({
      name: rawName,
      teacher: String(cell('teacher') ?? '').trim() || undefined,
      location: String(cell('location') ?? '').trim(),
      dayOfWeek: day as Course['dayOfWeek'],
      startMin: snap(start),
      endMin: snap(end),
    });
  });

  return { courses, errors, duplicates };
}

/** 读文件 → 解析。支持 .xlsx / .xls / .csv */
export async function parseCourseExcel(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { courses: [], errors: ['文件里没有工作表'], duplicates: 0 };
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
  return parseCourseRows(rows);
}
