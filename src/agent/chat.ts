/**
 * 小山的对话循环
 *
 * 一次用户输入 → 模型可能连着调几个工具 → 真正落到 IndexedDB → 再回一句话。
 * 最多 6 轮，防止模型在「读一下再读一下」里打转；每一步都留着痕迹，
 * 界面上要把「它到底动了什么」摊开给用户看。
 */

import { chatComplete, LlmError, type ChatMessage } from '@/lib/llm';
import { loadLlmSettings } from '@/lib/llmSettings';
import { runTool, TOOL_SCHEMAS } from '@/agent/tools';
import { avgSleepHours, todayCourses } from '@/data/queries';
import { getSleepLogs } from '@/data/store/profile';
import { lastNightSleep } from '@/data/queries';
import { fmtMin } from '@/types/contract';

export const SYSTEM_PROMPT = `你是「小山」，华中师范大学学生的本地校园助手。你住在用户这台设备的浏览器里，数据不出设备。

说话方式：
- 自称「小山」，不要叫自己 AI、助手、模型。用「我」，不用「本助手」。
- 中文，口语，短。一般 1–3 句，最多 5 句。不要列小标题、不要用 markdown 表格。
- 把人当人：除了课表，也关心ta有没有吃饭、有没有出门走走、睡得好不好；节日和纪念日可以说一句，但别煽情。
- 不确定就说不确定，不要编课程、考试、时间。

做事规则：
- 凡是要改数据（加课、改时间、加 DDL、记睡眠、改餐标），必须真的调用工具。没调工具就不要说「已经加好了」。
- 改之前如果不知道课程 id 或时间，先用 list_courses / list_exams 查。
- 工具报错（比如撞课）就把原因用自己的话告诉用户，并给一个替代方案（换个时间）。
- 改完用一句话说明改了什么，再提一句用户可以在哪个页面看到。
- 用户只是问问题（今天几节课、下周怎么样）时，查完直接回答，不要顺手改数据。

用户说累、困、烦、不想动、撑不住这类状态时：
- 先接住这句话，别回「你今天有 3 节课」这种复述。数据是用来帮你判断的，不是用来念的。
- 给 2–3 个很小的、现在就能做的选项：趴 20 分钟 / 出去走一圈 / 早点睡 / 先吃点东西 / 把这件事挪到明天。
- 每个选项带一句代价（例如「少刷 20 分钟手机」「晚上的整块时间会被切碎」），让用户自己挑。
- 如果确实和身体有关（连续几晚没睡够、饭没吃），可以说一句，但不要诊断、不要吓人。
- 最后问一句「要不要我帮你把 X 记下来 / 挪走」，把选择权留给用户。

今天的日期：{today}。`;

/**
 * 把本机情况压成几行给模型参考。
 * 用户随口说一句「好累」时，模型得知道昨晚睡了多久、今天还有几节课，
 * 才可能给出「先趴 20 分钟，下午那节可以挪」这种具体建议，而不是复述课表。
 */
export async function buildChatContext(now = new Date()): Promise<string> {
  try {
    const [courses, logs] = await Promise.all([todayCourses(now), getSleepLogs()]);
    const last = lastNightSleep(logs, now);
    const avg3 = avgSleepHours(logs, 3, now);
    const nextClass = courses.find((c) => c.endMin > now.getHours() * 60 + now.getMinutes());
    return [
      `今天课程：${courses.length} 节${nextClass ? `，下一节 ${nextClass.name} ${fmtMin(nextClass.startMin)} 开始` : ''}`,
      `昨晚睡眠：${last ? `${last.hours} 小时` : '没有记录'}`,
      `近三晚平均：${avg3 != null ? `${avg3.toFixed(1)} 小时` : '记录不足'}`,
    ].join('\n');
  } catch {
    return '';
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** 这一轮里小山做过的动作，给界面画成小条 */
  actions?: { name: string; summary: string; ok: boolean }[];
  error?: string;
}

export interface AgentReply {
  text: string;
  actions: { name: string; summary: string; ok: boolean }[];
}

const MAX_ROUNDS = 6;

export async function askXiaoshan(
  history: ChatTurn[],
  userText: string,
  options: { signal?: AbortSignal } = {},
): Promise<AgentReply> {
  const settings = loadLlmSettings();
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]}`;
  const local = await buildChatContext(today);
  const context = local
    ? `\n\n本地情况（只在有用的时候引用，用户没问就别念数字）：\n${local}`
    : '';

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT.replace('{today}', stamp) + context },
    ...history.slice(-8).map<ChatMessage>((t) => ({
      role: t.role,
      content: t.text,
    })),
    { role: 'user', content: userText },
  ];

  const actions: AgentReply['actions'] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await chatComplete(messages, {
      settings,
      tools: TOOL_SCHEMAS,
      temperature: 0.3,
      maxTokens: 700,
      signal: options.signal,
    });

    if (result.toolCalls.length === 0) {
      return { text: (result.content ?? '').trim() || '……（模型没说话，再问一次试试）', actions };
    }

    messages.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      const outcome = await runTool(call.function.name, call.function.arguments, { now: new Date() });
      actions.push({ name: call.function.name, summary: outcome.summary, ok: outcome.ok });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({ ok: outcome.ok, summary: outcome.summary, data: outcome.data ?? null }),
      });
    }
  }

  return {
    text: '这件事小山绕了几圈没做完，换个说法试试？',
    actions,
  };
}

/** 把 LlmError 翻成界面上的提示 */
export function describeLlmError(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
