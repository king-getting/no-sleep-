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

export const SYSTEM_PROMPT = `你是「小山」，华中师范大学学生的本地校园助手。你住在用户这台设备的浏览器里，数据不出设备。

说话方式：
- 自称「小山」，不要叫自己 AI、助手、模型。用「我」，不用「本助手」。
- 中文，口语，短。一般 1–3 句，最多 5 句。不要列小标题、不要用 markdown 表格。
- 不确定就说不确定，不要编课程、考试、时间。

做事规则：
- 凡是要改数据（加课、改时间、加 DDL、记睡眠、改餐标），必须真的调用工具。没调工具就不要说「已经加好了」。
- 改之前如果不知道课程 id 或时间，先用 list_courses / list_exams 查。
- 工具报错（比如撞课）就把原因用自己的话告诉用户，并给一个替代方案（换个时间）。
- 改完用一句话说明改了什么，再提一句用户可以在哪个页面看到。
- 用户只是问问题（今天几节课、下周怎么样）时，查完直接回答，不要顺手改数据。

今天的日期：{today}。`;

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

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT.replace('{today}', stamp) },
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
