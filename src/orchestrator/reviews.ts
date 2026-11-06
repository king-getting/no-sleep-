import { getSleepLogs } from '@/data/store/profile';
import { listExams } from '@/data/store/courses';
import { avgSleepHours, lastNightSleep, todayCourses } from '@/data/queries';
import { agentRegistry } from '@/agents/registry';
import { effectiveWeight } from '@/orchestrator/weights';
import { dailyBudget, fmtMin } from '@/types/contract';
import type {
  AgentContext,
  AgentId,
  AgentReview,
  Course,
  ExamItem,
  OptionCard,
  SleepLog,
} from '@/types/contract';

/**
 * 跨 Agent 评审（选项卡底下的「其他 Agent 怎么看」）
 *
 * 每个 Agent 只用自己的那一域数据给这条选项下一句判断：
 * 教务看「这条和课/DDL 撞不撞」，生活看「钱超没超今天的餐标」，
 * 健康看「占掉的时间从睡眠里出不出」，日程看「今天还剩多少机动时间」。
 *
 * 对同一条选项，四个 Agent 看到的是四个不同的数字，所以四句话不会撞车；
 * 对同一组里的不同选项，成本不同，判断也不同（8 分钟赶得上 / 50 分钟很紧）。
 *
 * 为什么放在编排器而不是 UI：课表、睡眠、DDL、餐标都是别的域的数据，
 * UI 手上没有，也不该有。
 */

interface ReviewData {
  now: Date;
  courses: Course[];
  lastNight?: SleepLog;
  avg7: number | null;
  nextDdl?: ExamItem;
  daily: number;
}

/** 一个 Agent 的评审结论：一句认可、一句不放心、一个影响强度 */
interface Verdict {
  pro: string;
  con: string;
  impact: number;
}

function defaultWeightOf(id: AgentId): number {
  return agentRegistry.find((a) => a.id === id)?.defaultWeight ?? 1;
}

/** 今天从 now 到 23:00 还剩多少分钟机动时间（扣掉还没上的课） */
function freeMinutesLeft(data: ReviewData): number {
  const nowMin = data.now.getHours() * 60 + data.now.getMinutes();
  const dayEnd = 23 * 60;
  if (nowMin >= dayEnd) return 0;
  const classMin = data.courses
    .filter((c) => c.endMin > nowMin)
    .reduce((sum, c) => sum + (Math.min(c.endMin, dayEnd) - Math.max(c.startMin, nowMin)), 0);
  return Math.max(0, dayEnd - nowMin - classMin);
}

export async function loadReviewData(ctx: AgentContext): Promise<ReviewData> {
  const [courses, logs, exams] = await Promise.all([todayCourses(ctx.now), getSleepLogs(), listExams()]);
  const upcoming = exams
    .filter((e) => new Date(e.at).getTime() > ctx.now.getTime())
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return {
    now: ctx.now,
    courses,
    lastNight: lastNightSleep(logs, ctx.now),
    avg7: avgSleepHours(logs, 7, ctx.now),
    nextDdl: upcoming.find((e) => e.kind === 'ddl') ?? upcoming[0],
    daily: dailyBudget(ctx.user),
  };
}

/** 这条选项本身在说什么。只按成本算相关度的话，「现在就睡」在健康轴上是 0%，说不通 */
function says(o: OptionCard, re: RegExp): boolean {
  return re.test(o.title + (o.note ?? '') + (o.when ?? ''));
}

const TOPIC_ACADEMIC = /课|复习|考试|DDL|作业|自习|背|刷题/;
const TOPIC_LIFE = /吃|饭|食堂|钱|省|快递|买|餐/;
const TOPIC_HEALTH = /睡|午休|小憩|熬夜|困|运动|体检|生病|发烧/;

/** 教务：这条和下一节课撞不撞，以及它怎么记账到 DDL */
function reviewByAcademic(o: OptionCard, d: ReviewData): Verdict {
  const nowMin = d.now.getHours() * 60 + d.now.getMinutes();
  const next = d.courses.find((c) => c.startMin > nowMin);
  const cost = o.cost.timeMin ?? 0;

  let pro: string;
  let impact: number;
  if (!next) {
    pro = '今天的课都上完了，时间随你排';
    impact = cost === 0 ? 0.05 : 0.15;
  } else {
    const window = next.startMin - nowMin;
    if (cost === 0) pro = `${fmtMin(next.startMin)} 有课，这条不占上课时间`;
    else if (cost + 15 <= window) pro = `${fmtMin(next.startMin)} 有课，这条 ${cost} 分钟赶得上`;
    else pro = `${fmtMin(next.startMin)} 有课，只剩 ${window} 分钟，很紧`;

    impact =
      cost === 0
        ? 0.05
        : Math.min(1, (cost / Math.max(30, window)) * 1.4 + (cost + 15 > window ? 0.35 : 0));
  }

  const con = d.nextDdl
    ? `「${d.nextDdl.title}」还剩 ${Math.max(1, Math.round((new Date(d.nextDdl.at).getTime() - d.now.getTime()) / 86400_000))} 天，花掉的时间我都记在它头上`
    : '今天没有硬截止，但这不等于有余地';

  return { pro, con, impact: says(o, TOPIC_ACADEMIC) ? Math.max(impact, 0.55) : impact };
}

/** 生活：钱超没超今天的餐标 */
function reviewByLife(o: OptionCard, d: ReviewData): Verdict {
  const money = o.cost.money;
  const cost = o.cost.timeMin ?? 0;
  if (money === undefined) {
    return {
      pro: cost === 0 ? '不花钱也不占时间' : `不花钱，只占 ${cost} 分钟`,
      con: '要专门跑一趟的话，来回也是成本',
      impact: Math.max(cost >= 45 ? 0.12 : 0.05, says(o, TOPIC_LIFE) ? 0.5 : 0),
    };
  }
  const impact = Math.max(
    Math.min(1, money / Math.max(1, d.daily)),
    says(o, TOPIC_LIFE) ? 0.5 : 0,
  );
  return money <= d.daily
    ? {
        pro: `¥${money} 在今天的餐标内（¥${d.daily.toFixed(0)}）`,
        con: `选完今天只剩 ¥${(d.daily - money).toFixed(0)} 的额度`,
        impact,
      }
    : {
        pro: `花钱换省事，¥${money} 买的是时间`,
        con: `超今天的餐标 ¥${(money - d.daily).toFixed(0)}，月底要还`,
        impact,
      };
}

/** 健康：占掉的时间从哪出 */
function reviewByHealth(o: OptionCard, d: ReviewData): Verdict {
  const cost = o.cost.timeMin ?? 0;
  const last = d.lastNight;
  const short = last ? last.hours < 6.5 : d.avg7 !== null && d.avg7 < 6.5;
  const impact = Math.min(1, cost / 90 + (cost > 0 && short ? 0.25 : 0));
  const pro =
    cost === 0
      ? '不占时间，睡眠窗口没动'
      : cost <= 30
        ? `只占 ${cost} 分钟，睡眠窗口基本没动`
        : `占 ${cost} 分钟，换来的休息值这个价`;

  const con = last
    ? `昨晚 ${last.hours}h，今天能补回来的不多`
    : d.avg7 !== null
      ? `近 7 天平均 ${d.avg7.toFixed(1)}h，我不想再往下压`
      : '睡眠记录是空的，这条我没法替你打包票';

  return {
    pro,
    con,
    impact: says(o, TOPIC_HEALTH) ? Math.max(impact, 0.6) : impact,
  };
}

/** 日程：今天的机动时间够不够 */
function reviewBySchedule(o: OptionCard, d: ReviewData): Verdict {
  const free = freeMinutesLeft(d);
  const cost = o.cost.timeMin ?? 0;
  const hours = Math.round((free / 60) * 10) / 10;
  const left = free - cost;
  const impact = free <= 0 ? 0.95 : cost === 0 ? 0.06 : Math.min(1, (cost / free) * 2);
  return {
    pro: `今天还剩 ${hours}h 机动时间，放得下`,
    con:
      cost === 0
        ? '不占时间，但也没给整块复习腾地方'
        : left < 90
          ? `扣掉这条只剩 ${Math.max(0, left)} 分钟缓冲，临时加事就没地方塞`
          : `扣完还剩 ${left} 分钟，会把整块时间切一刀`,
    impact,
  };
}

const LENS: Record<AgentId, (o: OptionCard, d: ReviewData) => Verdict> = {
  academic: reviewByAcademic,
  life: reviewByLife,
  health: reviewByHealth,
  schedule: reviewBySchedule,
};

/** 雷达图固定三条轴：学习 / 生活 / 健康。日程不参与这张图，避免第四根轴把三角压扁 */
const RADAR_AGENTS: AgentId[] = ['academic', 'life', 'health'];

/**
 * 给一条选项算出三个方向的一句话评审。
 * 三条轴固定（claude 提的选项也照样被三个方向看），这样雷达图的形状才可比。
 */
export function buildOptionReviews(
  option: OptionCard,
  _owner: AgentId | undefined,
  ctx: AgentContext,
  data: ReviewData,
): AgentReview[] {
  return RADAR_AGENTS.map((id) => {
    const { pro, con, impact } = LENS[id](option, data);
    return {
      agentId: id,
      weight: effectiveWeight(defaultWeightOf(id), ctx.mode, id),
      pro,
      con,
      impact,
    };
  });
}
