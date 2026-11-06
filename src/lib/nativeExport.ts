import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { buildBackup } from '@/data/store/backup';

/**
 * 原生导出（只在小山 App 里生效）
 *
 * 浏览器/PWA 拿不到可写的公共目录，App 里可以：把完整备份写成 JSON，
 * 放到手机「文档」目录，卸载重装也能拿回来。
 * Web 环境下调用会返回 unsupported，界面据此只显示浏览器那条路径。
 */

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export interface NativeExportResult {
  ok: boolean;
  path?: string;
  message: string;
}

export async function exportBackupToDevice(): Promise<NativeExportResult> {
  if (!isNativeApp()) {
    return { ok: false, message: '这个功能只在 App 里可用' };
  }

  try {
    const data = await buildBackup();
    const json = JSON.stringify(data, null, 2);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const path = `小山备份-${stamp}.json`;

    const res = await Filesystem.writeFile({
      path,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    return { ok: true, path: res.uri, message: '已写入手机「文档」目录' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
