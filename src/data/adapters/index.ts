import type { DirectionContext, DataSourceAdapter, RawItem } from '@/types/contract';
import { MOCK_CANTEEN_WINDOWS, MOCK_WEATHER } from '@/data/mock/canteen';
import { CCNU_NOTICES } from '@/data/mock/ccnu';
import { MOCK_NOTICES } from '@/data/mock/notices';
import { loadInterests, rankFeed, type ScoredItem } from '@/data/relevance';
import { mutedIds } from '@/data/store/feed';
import { readFeedCache } from '@/lib/feedRefresh';

/**
 * 数据源 adapter 注册表（契约 §5）
 * mock 与真实源实现同一 DataSourceAdapter 接口；接真实源只需在这里换注册。
 */

/**
 * 教务课表 adapter —— 只留接口，不实现。
 *
 * 学校的课表目前只有文件导出（.xls 网格表），没有可直连的公开接口；
 * 真要对接时需要登录态、验证码与学期参数，属于实现方自己处理的部分。
 * 这里把形状定下来：任何未来实现只要能产出 Course[]，就能直接接进课表页。
 */
export interface TimetableAdapter {
  id: string;
  /** 拉取整学期课表；实现方自行处理登录、缓存与错误 */
  fetchCourses(signal?: AbortSignal): Promise<Omit<import('@/types/contract').Course, 'id'>[]>;
}

/** 已注册的教务适配器；当前为空，接真实源时 push 一个实现进来 */
export const timetableAdapters: TimetableAdapter[] = [];

/** 身份过滤：通知类数据按校区 / 受众标签过滤（信息流「为什么推给我」的数据基础） */
function matchIdentity(item: RawItem, ctx: DirectionContext): boolean {
  if (item.campus && item.campus !== 'both' && item.campus !== ctx.user.identity.campus) return false;
  if (item.audience && item.audience.length > 0) {
    const { level, grade, college } = ctx.user.identity;
    const userTags = [level, grade, college];
    return item.audience.some((tag) => userTags.includes(tag));
  }
  return true;
}

/**
 * 通知源 = 华中师范大学真实通知快照 + 本机个人条目（快递）
 *
 * 真实快照抓自 jwc.ccnu.edu.cn「学生通知」与 www.ccnu.edu.cn「通知公告」，
 * 标题、日期、原文链接均为页面原文；正文只截开头一段（完整通知点「原文」）。
 * 前端直连学校站点会被 CORS 挡，且现场要断网演示，所以烘进包里当快照用。
 */
const ALL_NOTICES: RawItem[] = [...CCNU_NOTICES, ...MOCK_NOTICES];

const mockNoticeAdapter: DataSourceAdapter = {
  id: 'ccnu-notice',
  provides: ['notice', 'express', 'volunteer', 'convenience'],
  async fetch(type, ctx) {
    // 远端刷新到的条目优先，同 id 的覆盖包里烘好的快照
    const remote = await readFeedCache();
    const merged = new Map<string, RawItem>();
    for (const n of ALL_NOTICES) merged.set(n.id, n);
    for (const n of remote.items) merged.set(n.id, n);
    return [...merged.values()].filter((n) => n.type === type && matchIdentity(n, ctx));
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
export async function queryAdapters(type: string, ctx: DirectionContext): Promise<RawItem[]> {
  const matched = adapters.filter((a) => a.provides.includes(type));
  const results = await Promise.all(matched.map((a) => a.fetch(type, ctx)));
  return results.flat();
}

/** 信息流聚合的源类型（三类源混排：教务 / 讲座活动 / 生活服务） */
const FEED_TYPES = ['notice', 'volunteer', 'express', 'canteen-window', 'convenience'] as const;

/**
 * 信息流（B2）：四类源拉平后按「与我有多有关」排序（A7 打分），
 * 并在返回前剔除用户点过「与我无关」的条目——负反馈落库，刷新仍然生效。
 */
export async function queryFeed(ctx: DirectionContext, opts?: { includeMuted?: boolean }): Promise<ScoredItem[]> {
  const batches = await Promise.all(FEED_TYPES.map((type) => queryAdapters(type, ctx)));
  const items = batches.flat();
  const [interest, muted] = await Promise.all([loadInterests(), mutedIds()]);
  return rankFeed(items, ctx, interest, muted, opts);
}
