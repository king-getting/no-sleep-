import type { AgentContext, DataSourceAdapter, RawItem } from '@/types/contract';
import { MOCK_CANTEEN_WINDOWS, MOCK_WEATHER } from '@/data/mock/canteen';
import { MOCK_NOTICES } from '@/data/mock/notices';
import { loadInterests, rankFeed, type ScoredItem } from '@/data/relevance';
import { mutedIds } from '@/data/store/feed';

/**
 * 数据源 adapter 注册表（契约 §5）
 * mock 与真实教务源实现同一 DataSourceAdapter 接口；hackathon 后接真实源只需在这里换注册。
 */

/** 身份过滤：通知类数据按校区 / 受众标签过滤（信息流「为什么推给我」的数据基础） */
function matchIdentity(item: RawItem, ctx: AgentContext): boolean {
  if (item.campus && item.campus !== 'both' && item.campus !== ctx.user.identity.campus) return false;
  if (item.audience && item.audience.length > 0) {
    const { level, grade, college } = ctx.user.identity;
    const userTags = [level, grade, college];
    return item.audience.some((tag) => userTags.includes(tag));
  }
  return true;
}

const mockNoticeAdapter: DataSourceAdapter = {
  id: 'mock-notice',
  provides: ['notice', 'express'],
  async fetch(type, ctx) {
    return MOCK_NOTICES.filter((n) => n.type === type && matchIdentity(n, ctx));
  },
};

const mockCanteenAdapter: DataSourceAdapter = {
  id: 'mock-canteen',
  provides: ['canteen-window', 'convenience'],
  async fetch(type, ctx) {
    return MOCK_CANTEEN_WINDOWS.filter(
      (w) => w.type === type && matchIdentity(w, ctx),
    );
  },
};

const mockWeatherAdapter: DataSourceAdapter = {
  id: 'mock-weather',
  provides: ['weather'],
  async fetch() {
    return [MOCK_WEATHER];
  },
};

/** 注册表：新增数据源 = 加一个 adapter + 这里加一行 */
const adapters: DataSourceAdapter[] = [mockNoticeAdapter, mockCanteenAdapter, mockWeatherAdapter];

/** 按数据类型查询所有提供该类型的 adapter，汇总结果 */
export async function queryAdapters(type: string, ctx: AgentContext): Promise<RawItem[]> {
  const matched = adapters.filter((a) => a.provides.includes(type));
  const results = await Promise.all(matched.map((a) => a.fetch(type, ctx)));
  return results.flat();
}

/** 信息流聚合的源类型（三类源混排：教务 / 讲座活动 / 生活服务） */
const FEED_TYPES = ['notice', 'express', 'canteen-window', 'convenience'] as const;

/**
 * 信息流（B2）：四类源拉平后按「与我有多有关」排序（A7 打分），
 * 并在返回前剔除用户点过「与我无关」的条目——负反馈落库，刷新仍然生效。
 */
export async function queryFeed(ctx: AgentContext): Promise<ScoredItem[]> {
  const batches = await Promise.all(FEED_TYPES.map((type) => queryAdapters(type, ctx)));
  const items = batches.flat();
  const [interest, muted] = await Promise.all([loadInterests(), mutedIds()]);
  return rankFeed(items, ctx, interest, muted);
}
