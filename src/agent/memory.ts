import { chatComplete, parseJsonLoose } from '@/lib/llm';
import { isLlmReady, loadLlmSettings } from '@/lib/llmSettings';
import { loadChat } from '@/data/store/chat';
import { loadMemory, saveMemory, validateMemory } from '@/data/store/chatMemory';

/**
 * 从对话里抽长期记忆
 *
 * 触发条件：每攒够 6 条新对话、且模型可用、且上次抽过之后没有失败过。
 * 失败就静默跳过——记忆是增强，不该影响聊天本身。
 */

const MIN_NEW_TURNS = 6;

export async function maybeExtractMemory(): Promise<void> {
  const settings = loadLlmSettings();
  if (!isLlmReady(settings)) return;

  const [memory, all] = await Promise.all([loadMemory(), loadChat(200)]);
  const total = all.length;
  if (total < MIN_NEW_TURNS) return;
  if (total - memory.extractedAtCount < MIN_NEW_TURNS) return;

  const recent = all.slice(-24).map((t) => `${t.role === 'user' ? '用户' : '小山'}：${t.text}`).join('\n');

  const prompt = `下面是一段用户和校园助手「小山」的对话。请从中提取**关于用户本人的长期稳定信息**，供以后记住。

对话：
${recent}

已有记忆（不要重复）：
${memory.items.length ? memory.items.map((x) => `- ${x}`).join('\n') : '（无）'}

只输出 JSON：
{"items":["不超过 20 字的一条"]}

要求：
- 只记「长期有效、用户明确说过」的事实：作息（如「通常 1 点睡」）、偏好（如「不吃辣」）、固定安排（如「周三下午实验」）、身体情况（如「久坐腰疼」）。
- 不记一次性的情绪、天气、当天的课、临时决定。
- 每条 6–20 字，最多 3 条；没有值得记的就返回 {"items":[]}。
- 不要复述已有记忆。`;

  try {
    const res = await chatComplete(
      [
        { role: 'system', content: '你负责从对话中提取长期记忆，只输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      { settings, temperature: 0.2, maxTokens: 300 },
    );
    const parsed = parseJsonLoose<unknown>(res.content);
    const next = validateMemory(parsed, memory.items);
    if (next) await saveMemory(next, total);
  } catch {
    // 静默：记忆抽不出来不影响聊天
  }
}
