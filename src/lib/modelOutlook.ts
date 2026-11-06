/**
 * 用模型给「未来两天 / 下周 / 本周总结」各写一句人话
 *
 * 数字仍然由 `@/lib/outlook` 算（那里是纯函数，好验证），模型只负责把它
 * 翻成一句像人说的判断——算错的风险留在本地，措辞交给模型。
 */

import { chatComplete, parseJsonLoose } from '@/lib/llm';
import { isLlmReady, loadLlmSettings } from '@/lib/llmSettings';
import type { DayPlan, WeekForecast, WeekSummary } from '@/lib/outlook';
import { fmtHour } from '@/lib/outlook';

export interface OutlookNarrative {
  twoDays: string;
  nextWeek: string;
  lastWeek: string;
}

const CACHE_PREFIX = 'xiaoshan:outlook:';

function cacheKey(now: Date): string {
  return `${CACHE_PREFIX}${now.toISOString().slice(0, 10)}`;
}

export function readOutlookCache(now = new Date()): OutlookNarrative | null {
  try {
    const raw = localStorage.getItem(cacheKey(now));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OutlookNarrative;
    if (!parsed?.twoDays || !parsed?.nextWeek || !parsed?.lastWeek) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeOutlookCache(n: OutlookNarrative, now = new Date()): void {
  try {
    localStorage.setItem(cacheKey(now), JSON.stringify(n));
  } catch {
    /* 存不下就算了，不值得报错 */
  }
}

function dayLine(plan: DayPlan): string {
  const label = `${plan.date.getMonth() + 1}/${plan.date.getDate()}`;
  const courses = plan.courses.map((c) => `${fmtHour(c.startMin)} ${c.name}`).join('、') || '没课';
  const exams = plan.exams.map((e) => e.title).join('、') || '没有截止项';
  return `${label}：${courses}；${exams}`;
}

export function describePlansForModel(
  twoDays: DayPlan[],
  nextWeek: WeekForecast,
  lastWeek: WeekSummary,
): string {
  const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const weekDays = nextWeek.days
    .map((d, i) => `${WEEK_CN[i]} ${d.courses.length} 节（${(d.minutes / 60).toFixed(1)}h）`)
    .join('，');
  const busiest = nextWeek.busiest;
  const empty = nextWeek.days.filter((d) => d.courses.length === 0);
  const totalHours = (nextWeek.days.reduce((s, d) => s + d.minutes, 0) / 60).toFixed(1);
  return [
    '未来两天：',
    ...twoDays.map(dayLine),
    `下周：总共 ${nextWeek.courseCount} 节课，合计 ${totalHours} 小时；每天分布 ${weekDays}；${
      busiest ? `最忙 ${WEEK_CN[nextWeek.days.indexOf(busiest)]} ${busiest.courses.length} 节；` : ''
    }${empty.length ? `${empty.length} 天没课；` : ''}下周考试 ${
      nextWeek.exams.map((e) => e.title).join('、') || '无'
    }`,
    `上周总结：上课 ${lastWeek.courseCount} 节，复习完成 ${lastWeek.reviewDone}/${lastWeek.reviewPlanned}，平均睡眠 ${
      lastWeek.sleepAvg ?? '无记录'
    } 小时，遵从度 ${lastWeek.complianceDone}/${lastWeek.complianceTotal}。`,
  ].join('\n');
}

export async function generateOutlookNarrative(
  twoDays: DayPlan[],
  nextWeek: WeekForecast,
  lastWeek: WeekSummary,
  now = new Date(),
): Promise<OutlookNarrative | null> {
  const settings = loadLlmSettings();
  if (!isLlmReady(settings)) return null;

  const cached = readOutlookCache(now);
  if (cached) return cached;

  const data = describePlansForModel(twoDays, nextWeek, lastWeek);
  const res = await chatComplete(
    [
      {
        role: 'system',
        content:
          '你是校园助手「小山」。只根据给定的数字写三句短评，不要编造数字或课程。输出严格 JSON。',
      },
      {
        role: 'user',
        content: `${data}

按下面的 JSON 输出三段话，口语，别喊口号：
{"twoDays":"对接下来两天的安排，2 句以内，点出哪天最紧、哪天能松","nextWeek":"对下周的判断，2–3 句：总量、最忙哪天、最空哪天，最后给一个具体安排建议（复习放哪天 / 哪天出去走走 / 考试前怎么腾时间）","lastWeek":"对上周的一句复盘"}

要求：
- twoDays ≤ 60 字，nextWeek ≤ 110 字，lastWeek ≤ 45 字。
- 只能用上面给出的数字，不要编课程、时间、考试。
- 建议要具体到「把复习放到周四下午的空档」这种程度，不要「注意劳逸结合」。`,
      },
    ],
    { settings, temperature: 0.5, maxTokens: 400 },
  );

  const json = parseJsonLoose<Partial<OutlookNarrative>>(res.content);
  if (!json?.twoDays && !json?.nextWeek && !json?.lastWeek) return null;

  const narrative: OutlookNarrative = {
    twoDays: (json.twoDays ?? '').trim().slice(0, 80),
    nextWeek: (json.nextWeek ?? '').trim().slice(0, 140),
    lastWeek: (json.lastWeek ?? '').trim().slice(0, 60),
  };
  // 太敷衍的不上屏：宁可显示本地算好的那句
  if (!narrative.twoDays || narrative.nextWeek.length < 24 || !narrative.lastWeek) return null;
  writeOutlookCache(narrative, now);
  return narrative;
}
