/**
 * 生成小山全部图标（Node + sharp）
 *
 * 源头只有一个：public/icon.svg（深绿圆角底 + 米色山形 + 桂花）。
 * 由它派生出 Android 自适应图标、传统图标、启动图，以及 PWA 的 PNG 图标。
 *
 * 用法：node scripts/make-icons.mjs
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const RES = path.join(ROOT, 'android/app/src/main/res');
const PUBLIC = path.join(ROOT, 'public');

const INK = '#4A6B5C';      // 主色（底）
const PAPER = '#F7F4EC';    // 米色背景

const iconSvg = await readFile(path.join(PUBLIC, 'icon.svg'), 'utf8');

/** 把 icon.svg 里「山 + 花」抽出来，做成透明底前景层 */
function foregroundSvg() {
  const start = iconSvg.indexOf('<path');
  const end = iconSvg.lastIndexOf('</svg>');
  const inner = iconSvg.slice(start, end);
  // 自适应图标安全区是 66%，内容缩到画布的 60% 并居中
  const scale = (1080 * 0.6) / 512;
  const offset = (1080 - 512 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
</svg>`;
}

/** 传统图标（带底色，方形/圆形各一版） */
function legacySvg(round) {
  const radius = round ? 256 : 112;
  return iconSvg.replace('rx="112"', `rx="${radius}"`);
}

async function render(svg, size, out) {
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(out);
}

const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

let count = 0;

// 1. Android 传统图标 + 自适应前景
for (const [dpi, legacy, adaptive] of DENSITIES) {
  const dir = path.join(RES, `mipmap-${dpi}`);
  await mkdir(dir, { recursive: true });
  await render(legacySvg(false), legacy, path.join(dir, 'ic_launcher.png'));
  await render(legacySvg(true), legacy, path.join(dir, 'ic_launcher_round.png'));
  await render(foregroundSvg(), adaptive, path.join(dir, 'ic_launcher_foreground.png'));
  count += 3;
}

// 2. 自适应图标背景色
await writeFile(
  path.join(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${INK}</color>
</resources>
`,
);

// 3. 启动图：按现有 splash.png 的尺寸重画，米色底 + 居中的图标
const drawables = (await readdir(RES)).filter((d) => d.startsWith('drawable'));
for (const dirName of drawables) {
  const file = path.join(RES, dirName, 'splash.png');
  if (!existsSync(file)) continue;
  const meta = await sharp(file).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1080;
  const badge = Math.round(Math.min(w, h) * 0.32);
  const badgePng = await sharp(Buffer.from(iconSvg), { density: 300 }).resize(badge, badge).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: PAPER } })
    .composite([{ input: badgePng, gravity: 'center' }])
    .png()
    .toFile(file);
  count += 1;
}

// 4. PWA / 浏览器图标
await render(iconSvg, 192, path.join(PUBLIC, 'icon-192.png'));
await render(iconSvg, 512, path.join(PUBLIC, 'icon-512.png'));
// maskable：内容留出安全边距，避免被圆形裁切
const maskable = iconSvg
  .replace('viewBox="0 0 512 512"', 'viewBox="-64 -64 640 640"')
  .replace('width="512" height="512"', 'width="640" height="640"');
await render(maskable, 512, path.join(PUBLIC, 'icon-maskable-512.png'));
await render(iconSvg, 180, path.join(PUBLIC, 'apple-touch-icon.png'));
count += 4;

console.log(`generated ${count} icon files`);
