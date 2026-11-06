import { db } from './db';
import {
  readDirectionEnabled,
  readDirectionWeights,
  setBootMode,
  writeDirectionEnabled,
  writeDirectionWeights,
  type BootMode,
} from './boot';
import { getThemeChoice, setTheme, type ThemeChoice } from '@/lib/theme';

/**
 * 本机数据备份（导出 / 导入）
 *
 * 为什么需要：小山的数据全部落在 IndexedDB。清浏览器缓存、换手机、重装系统都会让它消失，
 * 而「清除全部本机数据」又是一键生效。没有备份出口，本地优先就等于「只能存在一次」。
 *
 * 备份是纯 JSON：不含任何密钥，不联网，导入前先整体校验，校验不过就原样不动。
 */

const TABLES = [
  'profiles',
  'prefs',
  'sleepLogs',
  'choices',
  'compliance',
  'courses',
  'exams',
  'feedMuted',
  'feedFav',
  'reviewBlocks',
  'missReasons',
] as const;

type TableName = (typeof TABLES)[number];

const FORCE_NORMAL_KEY = 'xiaoshan:force-normal';

export interface BackupFile {
  app: 'xiaoshan';
  schema: 1;
  exportedAt: string;
  tables: Partial<Record<TableName, unknown[]>>;
  settings: {
    boot?: BootMode;
    directions?: Record<string, boolean>;
    weights?: Record<string, number>;
    theme?: ThemeChoice;
    forceNormal?: string | null;
  };
}

export interface BackupSummary {
  rows: number;
  tables: number;
}

function tableOf(name: TableName) {
  return db.table(name);
}

/** 收集当前全部本机数据 */
export async function buildBackup(): Promise<BackupFile> {
  const tables: Partial<Record<TableName, unknown[]>> = {};
  for (const name of TABLES) {
    tables[name] = await tableOf(name).toArray();
  }
  return {
    app: 'xiaoshan',
    schema: 1,
    exportedAt: new Date().toISOString(),
    tables,
    settings: {
      boot: localStorage.getItem('xiaoshan:boot') === 'real' ? 'real' : 'demo',
      directions: readDirectionEnabled(),
      weights: readDirectionWeights(),
      theme: getThemeChoice(),
      forceNormal: localStorage.getItem(FORCE_NORMAL_KEY),
    },
  };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 导出为 JSON 文件并触发下载 */
export async function downloadBackup(): Promise<BackupSummary> {
  const data = await buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xiaoshan-backup-${stamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分浏览器会让下载中断，给一拍
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  let rows = 0;
  let count = 0;
  for (const name of TABLES) {
    const list = data.tables[name];
    if (list && list.length) {
      rows += list.length;
      count += 1;
    }
  }
  return { rows, tables: count };
}

function assertBackup(raw: unknown): BackupFile {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的备份文件');
  const obj = raw as Partial<BackupFile>;
  if (obj.app !== 'xiaoshan') throw new Error('这不是小山的备份文件');
  if (obj.schema !== 1) throw new Error(`备份版本 ${String(obj.schema)} 不受支持`);
  if (!obj.tables || typeof obj.tables !== 'object') throw new Error('备份里没有数据表');
  for (const [name, rows] of Object.entries(obj.tables)) {
    if (!(TABLES as readonly string[]).includes(name)) continue;
    if (!Array.isArray(rows)) throw new Error(`数据表 ${name} 格式不对`);
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error(`数据表 ${name} 里有异常记录`);
    }
  }
  return obj as BackupFile;
}

/**
 * 用备份覆盖本机数据（先清空再写入，整个过程在一个事务里，失败则回滚）。
 * 调用方负责在校验通过后再确认，并在成功后重载页面。
 */
export async function restoreBackup(json: string): Promise<BackupSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  const data = assertBackup(parsed);

  let rows = 0;
  let tables = 0;

  const stores = TABLES.map((name) => tableOf(name));
  await db.transaction('rw', stores, async () => {
    for (const name of TABLES) {
      const table = tableOf(name);
      await table.clear();
      const incoming = data.tables[name];
      if (Array.isArray(incoming) && incoming.length) {
        // bulkPut：备份里的主键原样带回；choices / compliance / missReasons 是自增主键，也照写
        await table.bulkPut(incoming as never[]);
        rows += incoming.length;
        tables += 1;
      }
    }
  });

  if (data.settings) {
    const { boot, directions, weights, theme, forceNormal } = data.settings;
    if (boot === 'real' || boot === 'demo') setBootMode(boot);
    if (directions) writeDirectionEnabled(directions);
    if (weights) writeDirectionWeights(weights);
    if (theme === 'light' || theme === 'dark' || theme === 'system') setTheme(theme);
    if (forceNormal === '1' || forceNormal === '0') localStorage.setItem(FORCE_NORMAL_KEY, forceNormal);
  }

  return { rows, tables };
}
