import { queryAdapters } from '@/data/adapters';
import { fmtMoney } from '@/lib/format';
import { dailyBudget } from '@/types/contract';
import type {
  AgentModule,
  AgentResult,
  Finding,
  MealNutrition,
  OptionCard,
  RawItem,
} from '@/types/contract';

/** 餐标占比标注：餐饮类选项卡标注占今日餐标的比例 */
function budgetText(price: number, daily: number): string {
  return `¥${price}，占今日餐标（¥${daily.toFixed(0)}）的 ${Math.round((price / daily) * 100)}%`;
}

/** 从窗口 payload 里读结构标签；数据源没标就返回 undefined（不猜） */
function nutritionOf(w: RawItem | undefined): MealNutrition | undefined {
  const n = w?.payload?.nutrition as MealNutrition | undefined;
  if (!n || typeof n.veg !== 'number' || typeof n.protein !== 'number' || typeof n.oil !== 'number') {
    return undefined;
  }
  return n;
}

function queueMin(w: RawItem, now: Date): number {
  const slots = (w.payload?.queueBySlot as number[] | undefined) ?? [5, 5, 10, 5];
  const min = now.getHours() * 60 + now.getMinutes();
  if (min < 10 * 60) return slots[0];
  if (min < 12 * 60 + 10) return slots[1]; // 12:10 前低峰
  if (min < 13 * 60) return slots[2];
  return slots[3];
}

/**
 * 生活 Agent：食堂 / 天气 / 生活服务
 * 午饭选项卡严格对应设计文档 §5.2 的三卡结构（钱 / 时间 / 依据全标注）。
 */
export const lifeAgent: AgentModule = {
  id: 'life',
  name: '生活',
  version: '0.1.0',
  capabilities: ['canteen.recommend', 'weather'],
  defaultWeight: 1,
  enabled: true,

  async run(ctx) {
    const findings: Finding[] = [];
    const suggestions: NonNullable<AgentResult['suggestions']> = [];
    const claims: NonNullable<AgentResult['conflictClaims']> = [];
    const daily = dailyBudget(ctx.user);
    const hour = ctx.now.getHours() + ctx.now.getMinutes() / 60;

    // ── 天气 ──
    const weather = await queryAdapters('weather', ctx);
    if (weather[0]) {
      findings.push({
        id: 'life:weather',
        type: 'fact',
        topic: '天气',
        confidence: 2,
        summary: weather[0].title,
        evidences: [{ agentId: 'life', text: weather[0].body ?? '', confidence: 2 }],
      });
    }

    // ── 快递（L1 可调和冲突的演示素材：与小憩建议同窗口） ──
    const express = await queryAdapters('express', ctx);
    if (express[0] && hour >= 10 && hour < 20) {
      findings.push({
        id: 'life:errand',
        type: 'suggestion',
        topic: '取快递',
        confidence: 3,
        summary: express[0].title,
      });
      suggestions.push({
        id: 'sug-express',
        topic: '取快递',
        priority: 3,
        slot: 'noon',
        sourceFindingIds: ['life:errand'],
        options: [
          {
            id: 'express-noon',
            title: '午饭顺路取掉（不单跑一趟）',
            note: '菜鸟驿站 · 午后是低峰',
            when: '午饭后',
            cost: { timeMin: 10, effort: 1 },
            pros: ['顺路，不用单独跑一趟'],
            cons: ['午间人略多，可能排 2 分钟'],
            fallback: '件继续放在驿站，明天 21:00 前还得来一趟',
            impacts: [{ horizon: 'short', text: '下午手上就有件，不用再惦记', agentId: 'life' }],
            evidences: [{ agentId: 'life', text: '驿站 21:00 关门，午后为低峰', confidence: 2 }],
          },
          {
            id: 'express-evening',
            title: '傍晚下课再取（午休不动）',
            note: '菜鸟驿站 · 晚高峰',
            when: '下课后 · 21:00 前',
            cost: { timeMin: 15, effort: 2 },
            pros: ['午间休息时间完整'],
            cons: ['晚高峰排队更久', '拖过 21:00 就得改天'],
            fallback: '件在驿站过夜，明天还得记着',
            impacts: [{ horizon: 'short', text: '晚间空档少 15 分钟', agentId: 'schedule' }],
            evidences: [{ agentId: 'life', text: express[0].body ?? '', confidence: 3 }],
          },
        ],
      });
    }

    // ── 三餐建议 ──
    const windows = await queryAdapters('canteen-window', ctx);
    const cvs = (await queryAdapters('convenience', ctx))[0];
    const w1 = windows.find((w) => w.id === 'ct-yitang-2f');
    const w2 = windows.find((w) => w.id === 'ct-gxy-light');

    if (hour >= 10 && hour < 14 && w1 && w2 && cvs) {
      // 午饭（§5.2 示例）
      const n1 = nutritionOf(w1);
      const n2 = nutritionOf(w2);
      const n3 = nutritionOf(cvs);
      const priceA = Number(w1.payload?.avgPrice ?? 8);
      const priceB = Number(w2.payload?.avgPrice ?? 15);
      const saveByA = Math.max(0, priceB - priceA);
      const walkA = Number(w1.payload?.walkMin ?? 3);
      const walkB = Number(w2.payload?.walkMin ?? 6);
      const lunchOptions: OptionCard[] = [
        {
          id: 'lunch-a',
          title: `去一食堂吃（比轻食省 ${saveByA} 元）`,
          note: '一食堂二楼经济窗口 · 12:10 前是低峰',
          when: '12:10 前',
          cost: { money: priceA, timeMin: queueMin(w1, ctx.now) + walkA, effort: 1 },
          nutrition: n1,
          pros: [`一天省 ${saveByA} 元，一个月约 ${saveByA * 30} 元`],
          cons: ['没有蔬菜、油偏重，下午三四点容易饿'],
          fallback: `到点随手买，花多少、有没有菜都不受控（今天日均 ${daily.toFixed(0)} 元）`,
          impacts: [{ horizon: 'short', text: '吃完还能歇 40 分钟再进教室', agentId: 'life' }],
          evidences: [
            { agentId: 'life', text: '该窗口 12:10 前为低峰', confidence: 2 },
            { agentId: 'life', text: `符合餐标预算：${budgetText(Number(w1.payload?.avgPrice ?? 8), daily)}`, confidence: 3 },
          ],
        },
        {
          id: 'lunch-b',
          title: '去桂香园吃轻食（午后不犯困）',
          note: '桂香园 · 现做，要等',
          when: '11:40 前',
          cost: { money: priceB, timeMin: queueMin(w2, ctx.now) + walkB, effort: 2 },
          nutrition: n2,
          pros: ['蔬菜蛋白齐全，午后不容易犯困'],
          cons: [`贵 ${saveByA} 元，本周餐标会吃紧`],
          fallback: '继续吃油重的那家，下午第二节课容易困',
          // 跨域依据（睡眠×轻食）由编排器在汇总阶段富化挂载，生活 Agent 不越域读数据（契约 §5.1）
          impacts: [{ horizon: 'long', text: '常选轻食会让本周餐标吃紧', agentId: 'life' }],
          evidences: [
            { agentId: 'life', text: budgetText(priceB, daily), confidence: 3 },
          ],
        },
        {
          id: 'lunch-c',
          title: '饭团 + 提前到教室（省 25 分钟）',
          note: '便利店 · 路上吃',
          when: '12:20 前',
          cost: { money: Number(cvs.payload?.avgPrice ?? 10), timeMin: 5, effort: 1 },
          nutrition: n3,
          pros: ['省下约 25 分钟，能提前进教室'],
          cons: ['没有蔬菜，吃得将就'],
          fallback: '午休按 90 分钟走，晚上可能得挤时间补预习',
          impacts: [{ horizon: 'short', text: '下午第一节课前能过一遍预习', agentId: 'schedule' }],
          // 跨域依据（碎片时间可预习）同样交给编排器富化
          evidences: [
            { agentId: 'life', text: budgetText(Number(cvs.payload?.avgPrice ?? 10), daily), confidence: 3 },
          ],
        },
      ];
      suggestions.push({
        id: 'sug-lunch',
        topic: '午饭吃什么',
        priority: 1,
        slot: 'noon',
        sourceFindingIds: ['life:weather'],
        options: lunchOptions,
      });

      // 「省钱」侧主张（契约 §4.5）：与健康 Agent 的「吃好」侧配对成 L2。
      // 只在日均餐标 30 元以下时成立——预算宽裕时这顿的差价本来就不痛不痒，
      // 天天弹一张「省 7 元还是吃好点」的卡只会变成噪音。
      if (daily < 30 && n1) {
        claims.push({
          topic: '今天的午饭',
          side: 'saving',
          plan: {
            agentId: 'life',
            id: 'lunch-saving',
            title: `省钱优先：一食堂 ${fmtMoney(priceA)} 一顿`,
            note: '一食堂二楼 · 12:10 前是低峰',
            when: '今天 12:10 前',
            cost: { money: priceA, timeMin: queueMin(w1, ctx.now) + walkA, effort: 1 },
            nutrition: n1,
            pros: [`比轻食省 ${saveByA} 元，一个月约 ${saveByA * 30} 元`],
            // 结构由卡上的「这一餐」那行给出，这里不再重复一遍
            cons: ['下午三四点容易饿'],
            fallback: '照昨天的吃法走，这个月餐标会提前见底',
            impacts: [{ horizon: 'long', text: '月底餐标还有余量，不用靠泡面收尾', agentId: 'life' }],
            evidences: [
              { agentId: 'life', text: budgetText(priceA, daily), confidence: 3 },
              { agentId: 'life', text: `日均餐标 ¥${daily.toFixed(0)}，低于 30 元时才提这条`, confidence: 2 },
            ],
          },
        });
      }
    } else if (hour < 9 && w1 && cvs) {
      // 早餐
      suggestions.push({
        id: 'sug-breakfast',
        topic: '早餐吃什么',
        priority: 1,
        slot: 'morning',
        sourceFindingIds: [],
        options: [
          {
            id: 'breakfast-a',
            title: '坐下吃（5 元顶饱）',
            note: '一食堂 · 豆浆 + 热干面',
            when: '7:40 前',
            cost: { money: 5, timeMin: 10, effort: 2 },
            pros: ['5 元顶饱，7:40 前基本不排队'],
            cons: ['要坐下吃，比路上多花 7 分钟'],
            fallback: '7:50 之后只剩冷的，或者空着上第一节课',
            impacts: [{ horizon: 'short', text: '上午连排不饿肚子', agentId: 'health' }],
            evidences: [{ agentId: 'life', text: budgetText(5, daily), confidence: 3 }],
          },
          {
            id: 'breakfast-b',
            title: '路上买着吃（多睡 10 分钟）',
            note: '便利店 · 饭团',
            when: '7:50 前',
            cost: { money: 8, timeMin: 3, effort: 1 },
            pros: ['3 分钟拿到，能多睡 10 分钟'],
            cons: ['比食堂贵 3 元，还没热的'],
            fallback: '要么更早起到食堂，要么空着上第一节课',
            impacts: [{ horizon: 'short', text: '早八不迟到', agentId: 'schedule' }],
            evidences: [{ agentId: 'life', text: budgetText(8, daily), confidence: 3 }],
          },
        ],
      });
    } else if (hour >= 16 && hour < 20) {
      // 晚餐（从简）
      suggestions.push({
        id: 'sug-dinner',
        topic: '晚饭吃什么',
        priority: 2,
        slot: 'evening',
        sourceFindingIds: [],
        options: [
          {
            id: 'dinner-a',
            title: '去面档吃（热乎，回宿舍顺路）',
            note: '沁园春 · 17:30 后排队变长',
            when: '17:30 前',
            cost: { money: 12, timeMin: 15, effort: 2 },
            pros: ['热乎，回宿舍顺路'],
            cons: ['比经济窗口贵 4 元', '17:30 后排队明显变长'],
            fallback: '拖到 19:00 才吃，晚自习少 40 分钟',
            impacts: [{ horizon: 'short', text: '吃完走到自习室不耽误', agentId: 'life' }],
            evidences: [{ agentId: 'life', text: budgetText(12, daily), confidence: 3 }],
          },
          {
            id: 'dinner-b',
            title: '去经济窗口（省 4 元）',
            note: '一食堂二楼 · 窗口少',
            when: '17:30 前',
            cost: { money: 8, timeMin: 10, effort: 1 },
            pros: ['比面档省 4 元'],
            cons: ['窗口少，选择不多'],
            fallback: '今天餐标多花 4 元，本周余量变窄',
            impacts: [{ horizon: 'long', text: '守住本周餐标', agentId: 'life' }],
            evidences: [{ agentId: 'life', text: budgetText(8, daily), confidence: 3 }],
          },
        ],
      });
    }

    const result: AgentResult = { agentId: 'life', findings };
    if (suggestions.length > 0) result.suggestions = suggestions;
    if (claims.length > 0) result.conflictClaims = claims;
    return result;
  },
};
