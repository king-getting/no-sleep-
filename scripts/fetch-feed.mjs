/**
 * 抓学校通知，生成 public/feed.json
 *
 * 为什么要在 CI 里抓：浏览器直连 jwc.ccnu.edu.cn 会被 CORS 挡，且手机端弱网时更不稳。
 * 交给 GitHub Actions 每天跑一次，把结果提交回仓库，Pages 随之重新发布；
 * App 每次打开信息流时拉这份 feed.json，就能拿到新通知。
 *
 * 学校站点多为 GBK，需按 charset 解码。抓不到（改版 / 超时 / 封 IP）时不覆盖旧文件，
 * 保留上一次的结果，避免把信息流清空。
 */
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public/feed.json');

const SOURCES = [
  { url: 'https://jwc.ccnu.edu.cn/index/tzgg.htm', source: '本科生院 · 通知公告', type: 'notice' },
  { url: 'https://jwc.ccnu.edu.cn/index/jwkx.htm', source: '本科生院 · 教务快讯', type: 'notice' },
];

const UA = 'Mozilla/5.0 (compatible; xiaoshan-feed/1.0; +https://github.com/king-getting/no-sleep-)';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  const head = buf.subarray(0, 2048).toString('latin1');
  const metaCharset = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (/charset=([\w-]+)/i.exec(contentType)?.[1] ?? metaCharset ?? 'utf-8').toLowerCase();
  const decoder = new TextDecoder(charset === 'gb2312' || charset === 'gbk' ? 'gbk' : charset);
  return decoder.decode(buf);
}

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

/** 把一页里的「文章链接 + 标题 + 日期」抠出来 */
function parseList(html, baseUrl, meta) {
  const items = [];
  // 直接按 <a 切块，避开正则回溯陷阱：每一块只取第一个 > 之前的属性
  for (const chunk of html.split('<a ').slice(1)) {
    const tagEnd = chunk.indexOf('>');
    if (tagEnd < 0) continue;
    const tag = chunk.slice(0, tagEnd);
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!href || !/info\/\d+\/\d+\.(?:htm|html)/i.test(href)) continue;

    const rest = chunk.slice(tagEnd + 1);
    const closeAt = rest.indexOf('</a>');
    let title = /title="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (!title.trim() && closeAt > 0) title = rest.slice(0, closeAt);
    title = stripTags(title);
    if (title.length < 6 || title.length > 100) continue;
    if (!/[\u4e00-\u9fa5]/.test(title)) continue;

    const url = new URL(href, baseUrl).toString();
    // 日期：这一条附近 600 字里找 2026-11-06 / 2026/11/06 / 2026年11月6日
    const tail = stripTags(chunk.slice(0, 600));
    const dm = /(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(tail);
    const publishedAt = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : undefined;

    items.push({
      id: `notice-${/info\/\d+\/(\d+)\./i.exec(href)?.[1] ?? url}`,
      type: meta.type,
      title,
      tags: ['通知'],
      source: meta.source,
      url,
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return items;
}

async function main() {
  const found = [];
  for (const src of SOURCES) {
    try {
      const html = await fetchText(src.url);
      const items = parseList(html, src.url, src);
      console.log(`${src.source}: ${items.length} 条`);
      found.push(...items);
    } catch (err) {
      console.warn(`${src.source} 抓取失败：${err instanceof Error ? err.message : err}`);
    }
  }

  const fresh = found.length;
  if (fresh < 5) {
    console.log(`只抓到 ${fresh} 条，判定为异常，保留原文件`);
    return;
  }

  // 合并旧条目，按 url 去重，新的在前
  let prev = [];
  if (existsSync(OUT)) {
    try {
      prev = JSON.parse(await readFile(OUT, 'utf8'));
      if (!Array.isArray(prev)) prev = [];
    } catch {
      prev = [];
    }
  }
  const byUrl = new Map();
  for (const item of found) byUrl.set(item.url ?? item.id, item);
  for (const item of prev) {
    const key = item.url ?? item.id;
    if (!byUrl.has(key)) byUrl.set(key, item);
  }
  const merged = [...byUrl.values()]
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 120);

  await writeFile(OUT, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`写入 ${merged.length} 条 → public/feed.json`);
}

await main();
