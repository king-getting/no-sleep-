import { db } from '@/data/store/db';
import { buildBackup } from '@/data/store/backup';

/**
 * 自动备份（桌面浏览器）
 *
 * 用 File System Access API：用户选一次文件，之后每次数据变化都把完整 JSON 写回同一个文件。
 * 手机浏览器不支持在后台静默写文件，所以那边仍然只能手动导出——这不是实现偷懒，
 * 是平台限制（iOS Safari 至今没有 File System Access API）。
 *
 * 文件句柄存在 IndexedDB 的 meta 表里（句柄不能序列化进 localStorage）；
 * localStorage 只放「上次写入时间」与「上次内容的指纹」。
 */

const HANDLE = 'backup-handle';
const LAST_AT = 'xiaoshan:backup-last-at';
const LAST_HASH = 'xiaoshan:backup-last-hash';

type FilePickerWindow = Window & {
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
};

/** TS 的 DOM 类型里还没带权限方法，这里补上 */
type PermissionedHandle = FileSystemFileHandle & {
  queryPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
};

export function supportsAutoBackup(): boolean {
  return typeof (window as FilePickerWindow).showSaveFilePicker === 'function';
}

export function autoBackupLastAt(): string | null {
  return localStorage.getItem(LAST_AT);
}

export async function autoBackupFileName(): Promise<string | null> {
  const rec = await db.meta.get(HANDLE).catch(() => null);
  const handle = rec?.value as FileSystemFileHandle | undefined;
  return handle?.name ?? null;
}

/** 选一个文件作为备份目标；返回文件名，取消则返回 null */
export async function pickBackupTarget(): Promise<string | null> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (!picker) throw new Error('当前浏览器不支持自动备份');

  const handle = await picker({
    suggestedName: `xiaoshan-backup-${new Date().toISOString().slice(0, 10)}.json`,
    types: [{ description: '小山备份', accept: { 'application/json': ['.json'] } }],
  });
  await db.meta.put({ key: HANDLE, value: handle });
  return handle.name;
}

export async function disableAutoBackup(): Promise<void> {
  await db.meta.delete(HANDLE).catch(() => {});
  localStorage.removeItem(LAST_AT);
  localStorage.removeItem(LAST_HASH);
}

async function getHandle(): Promise<PermissionedHandle | null> {
  const rec = await db.meta.get(HANDLE).catch(() => null);
  return (rec?.value as PermissionedHandle | undefined) ?? null;
}

function hash(text: string): string {
  // 轻量指纹：长度 + 32 位滚动哈希，够判断「内容变没变」
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

/**
 * 立即写一次。返回 'written' | 'unchanged' | 'no-target' | 'error'。
 * 权限被收回（浏览器要求重新授权）时返回 'error'，由界面提示用户重新选择。
 */
export async function writeAutoBackup(opts?: { force?: boolean; interactive?: boolean }): Promise<
  'written' | 'unchanged' | 'no-target' | 'needs-permission' | 'error'
> {
  const handle = await getHandle();
  if (!handle) return 'no-target';

  try {
    const data = await buildBackup();
    const text = JSON.stringify(data, null, 2);
    const fp = hash(text);
    if (!opts?.force && localStorage.getItem(LAST_HASH) === fp) return 'unchanged';

    // 浏览器可能把权限收回（尤其在重开浏览器后）。后台调用不弹窗，交给界面提示重选。
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      if (!opts?.interactive) return 'needs-permission';
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') return 'needs-permission';
    }

    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();

    localStorage.setItem(LAST_HASH, fp);
    localStorage.setItem(LAST_AT, new Date().toISOString());
    return 'written';
  } catch {
    return 'error';
  }
}

/**
 * 由界面在「打开后」「定时」「切走」时调用：只做一次便宜判断，
 * 内容没变就不写，避免每 5 分钟刷一次磁盘。
 */
export async function maybeAutoBackup(): Promise<void> {
  if (!supportsAutoBackup()) return;
  const handle = await getHandle();
  if (!handle) return;
  await writeAutoBackup();
}
