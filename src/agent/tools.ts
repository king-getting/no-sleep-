/**
 * 小山能对本地数据做的操作（工具层）
 *
 * 只有列在这里的动作，模型才能碰；每个动作都是对 IndexedDB 的一次正常写入，
 * 和用户手点界面走的是同一批 store 函数 —— 没有「只有 AI 能走」的特权路径，
 * 也就不会出现界面和对话两边数据对不上的情况。
 */

import {
  addCourse,
  addExam,
  deleteCourse,
  listCourses,
  listExams,
  updateCourse,
} from '@/data/store/courses';
import { getProfile, getSleepLogs, saveProfile, upsertSleepLog } from '@/data/store/profile';
import { listReviewBlocks } from '@/data/store/review';
import { getPreferences } from '@/data/store/profile';
import { courseOccursOn, effectiveSemesterStart, weekOfDate } from '@/lib/weeks';
import { emitDataChanged } from '@/lib/dataEvents';
import type { ToolSchema } from '@/lib/llm';
import type { Course, ExamItem } from '@/types/contract';

/** 模型返回的 HH:MM → 分钟；容忍 8:5 这种写法 */
export function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/.exec(String(text));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function fmtClock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

const DAY_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface ToolContext {
  now: Date;
}

export interface ToolResult {
  ok: boolean;
  /** 给模型看的结构化结果 */
  data?: unknown;
  /** 给人看的一句话 */
  summary: string;
  /** 这次调用改动了数据 */
  wrote?: boolean;
}

export interface ToolDef {
  schema: ToolSchema;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 今天 / 明天 / 周一…… → dayOfWeek 1–7 */
function parseDay(text: string, now: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  const t = asString(text);
  if (!t) return null;
  const toDow = (i: number) => (((i + 6) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  if (t === '今天' || t === '今日') return toDow(now.getDay());
  if (t === '明天' || t === '明日') return toDow(now.getDay() + 1);
  if (t === '后天') return toDow(now.getDay() + 2);
  const cn = ['一', '二', '三', '四', '五', '六', '日'];
  const idx = cn.findIndex((c) => t === `周${c}` || t === `星期${c}` || t === `礼拜${c}`);
  if (idx >= 0) return (idx + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  if (/^[1-7]$/.test(t)) return Number(t) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return null;
}

function findCourse(courses: Course[], args: Record<string, unknown>): Course | null {
  const id = asString(args.courseId);
  if (id) return courses.find((c) => c.id === id) ?? null;
  const name = asString(args.name);
  if (!name) return null;
  const exact = courses.filter((c) => c.name === name);
  if (exact.length === 1) return exact[0];
  const dayOfWeek = parseDay(asString(args.dayOfWeek), new Date());
  if (dayOfWeek) {
    const hit = exact.find((c) => c.dayOfWeek === dayOfWeek) ?? courses.find((c) => c.name.includes(name));
    return hit ?? null;
  }
  return exact[0] ?? courses.find((c) => c.name.includes(name)) ?? null;
}

export const TOOLS: Record<string, ToolDef> = {
  list_courses: {
    schema: {
      type: 'function',
      function: {
        name: 'list_courses',
        description: '读本机课表。想知道「今天有什么课」或改课前先确认课程 id 时调用。',
        parameters: {
          type: 'object',
          properties: {
            day: { type: 'string', description: '可选，如「今天」「明天」「周三」；不填返回整周' },
          },
        },
      },
    },
    async run(args, ctx) {
      const all = (await listCourses()).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin);
      const day = parseDay(asString(args.day), ctx.now);
      const prefs = await getPreferences().catch(() => null);
      const semesterStart = effectiveSemesterStart(prefs?.semesterStart, ctx.now);
      const thisWeek = weekOfDate(ctx.now, semesterStart);

      // 必须按「这周到底上不上」过滤：1–8 周的课到了第 10 周不能算进今天。
      // 之前只按星期几筛，于是「今天 1 节课」被说成 3 节。
      const picked = all.filter((c) => {
        if (day) {
          if (c.dayOfWeek !== day) return false;
          const d = new Date(ctx.now);
          const todayDow = ctx.now.getDay() === 0 ? 7 : ctx.now.getDay();
          d.setDate(d.getDate() + ((day - todayDow + 7) % 7));
          return courseOccursOn(c, d, semesterStart);
        }
        return !thisWeek || !c.weeks?.length || c.weeks.includes(thisWeek);
      });

      return {
        ok: true,
        data: picked.map((c) => ({
          id: c.id,
          name: c.name,
          dayOfWeek: c.dayOfWeek,
          day: DAY_LABEL[c.dayOfWeek],
          start: fmtClock(c.startMin),
          end: fmtClock(c.endMin),
          location: c.location,
          teacher: c.teacher ?? null,
          weeks: c.weeks ?? null,
        })),
        summary: day
          ? `${thisWeek ? `第 ${thisWeek} 周，` : ''}${DAY_LABEL[day]}有 ${picked.length} 节课`
          : `${thisWeek ? `第 ${thisWeek} 周，` : ''}这周共 ${picked.length} 节课`,
      };
    },
  },

  add_course: {
    schema: {
      type: 'function',
      function: {
        name: 'add_course',
        description: '往课表里加一门课。时间用 HH:MM，星期用「周三」这种写法。用户说「周三上午加一门高数」就调这个。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '课程名，如「高等数学 A（下）」' },
            dayOfWeek: { type: 'string', description: '周几，如「周三」或「3」' },
            start: { type: 'string', description: '开始时间 HH:MM' },
            end: { type: 'string', description: '结束时间 HH:MM' },
            location: { type: 'string', description: '地点，不知道就留空' },
            teacher: { type: 'string', description: '老师，可选' },
          },
          required: ['name', 'dayOfWeek', 'start', 'end'],
        },
      },
    },
    async run(args) {
      const name = asString(args.name);
      const dayOfWeek = parseDay(asString(args.dayOfWeek), new Date());
      const startMin = parseClock(asString(args.start));
      const endMin = parseClock(asString(args.end));
      if (!name) return { ok: false, summary: '缺课程名' };
      if (!dayOfWeek) return { ok: false, summary: '没听懂是周几，用「周三」这种写法' };
      if (startMin == null || endMin == null) return { ok: false, summary: '时间格式要是 HH:MM' };
      if (endMin <= startMin) return { ok: false, summary: '结束时间要晚于开始时间' };

      const courses = await listCourses();
      const clash = courses.find(
        (c) => c.dayOfWeek === dayOfWeek && startMin < c.endMin && c.startMin < endMin,
      );
      if (clash) {
        return {
          ok: false,
          summary: `${DAY_LABEL[dayOfWeek]} ${fmtClock(clash.startMin)}–${fmtClock(clash.endMin)} 已经有「${clash.name}」，会撞课`,
        };
      }

      const course: Course = {
        id: `c-${Date.now().toString(36)}`,
        name,
        dayOfWeek,
        startMin,
        endMin,
        location: asString(args.location) || '待定',
        ...(asString(args.teacher) ? { teacher: asString(args.teacher) } : {}),
      };
      await addCourse(course);
      emitDataChanged();
      return {
        ok: true,
        wrote: true,
        data: { id: course.id },
        summary: `加到${DAY_LABEL[dayOfWeek]} ${fmtClock(startMin)}–${fmtClock(endMin)}：${name}`,
      };
    },
  },

  update_course: {
    schema: {
      type: 'function',
      function: {
        name: 'update_course',
        description: '改已有课程的时间/地点/名字。用 name 或 courseId 定位。',
        parameters: {
          type: 'object',
          properties: {
            courseId: { type: 'string', description: '课程 id，不确定就用 name' },
            name: { type: 'string', description: '要改的课程名' },
            dayOfWeek: { type: 'string', description: '改成周几，可选' },
            start: { type: 'string', description: '新开始时间 HH:MM，可选' },
            end: { type: 'string', description: '新结束时间 HH:MM，可选' },
            location: { type: 'string', description: '新地点，可选' },
          },
        },
      },
    },
    async run(args) {
      const courses = await listCourses();
      const target = findCourse(courses, args);
      if (!target) return { ok: false, summary: '没找到这门课，先 list_courses 看一下' };
      const patch: Partial<Omit<Course, 'id'>> = {};
      const dayOfWeek = parseDay(asString(args.dayOfWeek), new Date());
      if (dayOfWeek) patch.dayOfWeek = dayOfWeek;
      const startMin = parseClock(asString(args.start));
      if (startMin != null) patch.startMin = startMin;
      const endMin = parseClock(asString(args.end));
      if (endMin != null) patch.endMin = endMin;
      if (asString(args.location)) patch.location = asString(args.location);
      if (Object.keys(patch).length === 0) return { ok: false, summary: '没给要改什么' };
      await updateCourse(target.id, patch);
      emitDataChanged();
      return { ok: true, wrote: true, summary: `改好了：${target.name}` };
    },
  },

  delete_course: {
    schema: {
      type: 'function',
      function: {
        name: 'delete_course',
        description: '删掉一门课。用 name 或 courseId 定位。',
        parameters: {
          type: 'object',
          properties: {
            courseId: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    },
    async run(args) {
      const courses = await listCourses();
      const target = findCourse(courses, args);
      if (!target) return { ok: false, summary: '没找到这门课' };
      await deleteCourse(target.id);
      emitDataChanged();
      return { ok: true, wrote: true, summary: `删掉了：${target.name}` };
    },
  },

  list_exams: {
    schema: {
      type: 'function',
      function: {
        name: 'list_exams',
        description: '读考试与 DDL 列表（含剩余天数和掌握度）。',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run(_args, ctx) {
      const exams = (await listExams()).slice().sort((a, b) => a.at.localeCompare(b.at));
      return {
        ok: true,
        data: exams.map((e) => ({
          id: e.id,
          title: e.title,
          kind: e.kind,
          at: e.at,
          days: Math.max(0, Math.round((new Date(e.at).getTime() - ctx.now.getTime()) / 86_400_000)),
          mastery: e.mastery ?? null,
        })),
        summary: `共 ${exams.length} 项待办`,
      };
    },
  },

  add_exam: {
    schema: {
      type: 'function',
      function: {
        name: 'add_exam',
        description: '加一场考试或一个 DDL。at 用「YYYY-MM-DD HH:MM」。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            kind: { type: 'string', enum: ['exam', 'ddl'], description: 'exam=考试，ddl=作业截止' },
            at: { type: 'string', description: 'YYYY-MM-DD HH:MM' },
            mastery: { type: 'number', description: '掌握度自评 1–5，可选' },
          },
          required: ['title', 'kind', 'at'],
        },
      },
    },
    async run(args) {
      const title = asString(args.title);
      const kind = asString(args.kind) === 'ddl' ? 'ddl' : 'exam';
      const raw = asString(args.at).replace('T', ' ');
      const parsed = new Date(raw.replace(/-/g, '/'));
      if (!title) return { ok: false, summary: '缺标题' };
      if (Number.isNaN(parsed.getTime())) return { ok: false, summary: '时间看不懂，用 YYYY-MM-DD HH:MM' };
      const mastery = Number(args.mastery);
      const exam: ExamItem = {
        id: `e-${Date.now().toString(36)}`,
        title,
        kind,
        at: parsed.toISOString(),
        ...(mastery >= 1 && mastery <= 5 ? { mastery: Math.round(mastery) as 1 | 2 | 3 | 4 | 5 } : {}),
      };
      await addExam(exam);
      emitDataChanged();
      return { ok: true, wrote: true, data: { id: exam.id }, summary: `记下了：${title}（${kind === 'exam' ? '考试' : 'DDL'}）` };
    },
  },

  log_sleep: {
    schema: {
      type: 'function',
      function: {
        name: 'log_sleep',
        description: '记一晚睡眠。date 默认昨晚，hours 是睡了多久（小时）。',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD，指这一晚' },
            hours: { type: 'number', description: '睡了几个小时，如 6.5' },
            bedAt: { type: 'string', description: '几点睡，HH:MM，可选' },
          },
          required: ['hours'],
        },
      },
    },
    async run(args) {
      const hours = Number(args.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 16) return { ok: false, summary: '小时数不合理' };
      const date = asString(args.date) || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, summary: '日期要 YYYY-MM-DD' };
      const bedTimeMin = parseClock(asString(args.bedAt));
      await upsertSleepLog({ date, hours, ...(bedTimeMin != null ? { bedTimeMin } : {}) });
      emitDataChanged();
      return { ok: true, wrote: true, summary: `记下了 ${date} 睡了 ${hours} 小时` };
    },
  },

  list_review_blocks: {
    schema: {
      type: 'function',
      function: {
        name: 'list_review_blocks',
        description: '读复习草案（每块日期、时间段、属于哪场考试、是否已完成）。',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run() {
      const blocks = (await listReviewBlocks()).slice().sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
      return {
        ok: true,
        data: blocks.slice(0, 40).map((b) => ({
          id: b.id,
          date: b.date,
          start: fmtClock(b.startMin),
          end: fmtClock(b.endMin),
          examId: b.examId,
          done: b.done,
        })),
        summary: `草案里 ${blocks.length} 段，已完成 ${blocks.filter((b) => b.done).length} 段`,
      };
    },
  },

  get_profile: {
    schema: {
      type: 'function',
      function: { name: 'get_profile', description: '读用户画像（身份、月餐标、身体基线）。', parameters: { type: 'object', properties: {} } },
    },
    async run() {
      const profile = await getProfile();
      const sleeps = await getSleepLogs();
      const last = sleeps.slice(-1)[0];
      return {
        ok: true,
        data: {
          identity: profile ? profile.identity : null,
          mealBudgetMonthly: profile ? profile.mealBudgetMonthly : null,
          bodyBaseline: profile?.bodyBaseline ?? null,
          isDemo: profile?.isDemo ?? false,
          lastSleep: last ?? null,
        },
        summary: profile ? '画像读到了' : '还没有画像',
      };
    },
  },

  update_profile: {
    schema: {
      type: 'function',
      function: {
        name: 'update_profile',
        description: '改月餐标（元）。用户说「这个月饭钱预算改成 800」就调这个。',
        parameters: {
          type: 'object',
          properties: { mealBudgetMonthly: { type: 'number', description: '月餐标，元' } },
          required: ['mealBudgetMonthly'],
        },
      },
    },
    async run(args) {
      const budget = Number(args.mealBudgetMonthly);
      if (!Number.isFinite(budget) || budget < 100 || budget > 20000) return { ok: false, summary: '餐标数值不合理' };
      const profile = await getProfile();
      if (!profile) return { ok: false, summary: '还没建档，改不了' };
      await saveProfile({ ...profile, mealBudgetMonthly: Math.round(budget) });
      emitDataChanged();
      return { ok: true, wrote: true, summary: `月餐标改成 ¥${Math.round(budget)}` };
    },
  },

  rerun_report: {
    schema: {
      type: 'function',
      function: {
        name: 'rerun_report',
        description: '让首页按最新数据重算一次报告。改完课表/考试/睡眠后可以调，用户不用自己刷新。',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run() {
      emitDataChanged();
      return { ok: true, wrote: false, summary: '已让首页按最新数据重算' };
    },
  },
};

export const TOOL_SCHEMAS: ToolSchema[] = Object.values(TOOLS).map((t) => t.schema);

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, summary: `没有这个工具：${name}` };
  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      return { ok: false, summary: '参数不是合法 JSON' };
    }
  }
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    return { ok: false, summary: `执行失败：${err instanceof Error ? err.message : String(err)}` };
  }
}
