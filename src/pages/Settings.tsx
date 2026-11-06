import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { directionRegistry } from '@/directions/registry';
import ModelSettings from '@/ui/settings/ModelSettings';
import Fold from '@/ui/settings/Fold';
import { clearAllData, getPreferences, getProfile, saveProfile } from '@/data/store/profile';
import { clearFeedState } from '@/data/store/feed';
import { downloadBackup, restoreBackup } from '@/data/store/backup';
import { clearLocalPrefs, readDirectionEnabled, readDirectionWeights, writeDirectionEnabled, writeDirectionWeights } from '@/data/store/boot';
import { getThemeChoice, setTheme, type ThemeChoice } from '@/lib/theme';
import { effectiveWeight } from '@/orchestrator/weights';
import { archetypeOf, effectsOf, traitsLine } from '@/lib/assessment';
import {
  autoBackupFileName,
  autoBackupLastAt,
  disableAutoBackup,
  pickBackupTarget,
  supportsAutoBackup,
  writeAutoBackup,
} from '@/lib/autobackup';
import { canPromptInstall, isIosSafari, isStandalone, promptInstall, subscribePwaInstall } from '@/lib/pwaInstall';
import { exportBackupToDevice, isNativeApp } from '@/lib/nativeExport';
import type { DirectionId, HabitTraits, UserProfile } from '@/types/contract';

/**
 * 设置页
 *
 * 四组能力：
 *   1. 思考方向逐个启停 —— 直接改注册表 enabled 并持久化，关掉健康 方向 后下一轮报告不含健康建议
 *   2. 画像编辑 —— 餐标 / 身体基线 / 校区（身份主力在 onboarding，这里只补常用项）
 *   3. 数据 —— 备份导出 / 导入、清除全部本机数据（回到 onboarding）
 */


const AGENT_LABEL: Record<string, string> = {
  academic: '学习视角',
  life: '生活视角',
  health: '健康视角',
  schedule: '日程视角',
};

export default function Settings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [budget, setBudget] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [weightTick, setWeightTick] = useState(0);
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [traits, setTraits] = useState<HabitTraits | null>(null);
  const [installable, setInstallable] = useState(false);
  const [autoName, setAutoName] = useState<string | null>(null);
  const [autoAt, setAutoAt] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      const p = await getProfile().catch(() => null);
      setProfile(p);
      if (p) {
        setBudget(String(p.mealBudgetMonthly));
        setHeight(p.bodyBaseline?.heightCm ? String(p.bodyBaseline.heightCm) : '');
        setWeight(p.bodyBaseline?.weightKg ? String(p.bodyBaseline.weightKg) : '');
      }
      const persisted = readDirectionEnabled();
      const weights = readDirectionWeights();
      const map: Record<string, boolean> = {};
      for (const a of directionRegistry) {
        // 持久化的值优先；未持久化时用注册表默认值
        if (persisted[a.id] !== undefined) a.enabled = persisted[a.id];
        if (weights[a.id] !== undefined) a.defaultWeight = weights[a.id];
        map[a.id] = a.enabled;
      }
      setEnabled(map);
      setThemeState(getThemeChoice());
      const prefs = await getPreferences().catch(() => null);
      setTraits(prefs?.traits ?? null);
      setAutoName(await autoBackupFileName());
      setAutoAt(autoBackupLastAt());
    })();
  }, []);

  // 安装能力是异步到达的（beforeinstallprompt），订阅一下，到了再刷新按钮状态
  useEffect(() => {
    setInstallable(canPromptInstall());
    return subscribePwaInstall(() => setInstallable(canPromptInstall()));
  }, []);

  function toggleAgent(id: string) {
    const next = !enabled[id];
    const map = { ...enabled, [id]: next };
    setEnabled(map);
    const agent = directionRegistry.find((a) => a.id === id);
    if (agent) agent.enabled = next;
    writeDirectionEnabled(map);
    toast(next ? `已启用${AGENT_LABEL[id] ?? id}` : `已停用${AGENT_LABEL[id] ?? id}`, {
      description: '下一份报告生效；历史报告不变。',
    });
  }

  /** 权重档位：0.5–3，步进 0.5。改的是注册表单例 + localStorage，下一轮报告生效 */
  function bumpWeight(id: DirectionId, delta: number) {
    const agent = directionRegistry.find((a) => a.id === id);
    if (!agent) return;
    const next = Math.min(3, Math.max(0.5, Math.round((agent.defaultWeight + delta) * 10) / 10));
    if (next === agent.defaultWeight) return;
    agent.defaultWeight = next;
    const map: Record<string, number> = {};
    for (const a of directionRegistry) map[a.id] = a.defaultWeight;
    writeDirectionWeights(map);
    setWeightTick((n) => n + 1);
    toast(`${AGENT_LABEL[id] ?? id} 权重 ${next}`, {
      description: `生存模式下折算为 ×${effectiveWeight(next, 'exam', id).toFixed(1)}；普通模式只影响同优先级排序。`,
    });
  }

  async function saveProfileEdits() {
    if (!profile) return;
    setSaving(true);
    try {
      const next: UserProfile = {
        ...profile,
        mealBudgetMonthly: Number(budget) || profile.mealBudgetMonthly,
        bodyBaseline:
          height || weight
            ? { heightCm: height ? Number(height) : undefined, weightKg: weight ? Number(weight) : undefined }
            : undefined,
      };
      await saveProfile(next);
      await getPreferences(); // 确保 prefs 记录存在（清库后首次进入设置页的边缘情况）
      setProfile(next);
      toast('已保存', { description: '下一份报告会按新的餐标 / 基线计算。' });
    } finally {
      setSaving(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    try {
      const s = await downloadBackup();
      toast('备份已导出', { description: `${s.tables} 张表 / ${s.rows} 条记录，已存到下载目录。` });
    } catch (e) {
      toast('导出失败', { description: e instanceof Error ? e.message : '未知错误' });
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      toast('文件过大，可能不是小山的备份');
      return;
    }
    const text = await file.text();
    if (!window.confirm('导入会用备份覆盖这台设备上的全部数据，当前数据不会保留。\n\n继续？')) return;
    setBusy(true);
    try {
      const s = await restoreBackup(text);
      toast('导入完成，正在重载…', { description: `${s.tables} 张表 / ${s.rows} 条记录` });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast('导入失败，本机数据未改动', { description: e instanceof Error ? e.message : '未知错误' });
      setBusy(false);
    }
  }


  async function wipeAll() {
    if (!window.confirm('将清空这台设备上的全部数据：课表、考试、睡眠、复习草案、收藏与偏好。\n\n这一步不可撤销，确定继续？')) return;
    await clearAllData();
    await clearFeedState();
    clearLocalPrefs();
    window.location.reload();
  }

  function applyTheme(next: ThemeChoice) {
    setTheme(next);
    setThemeState(next);
  }

  /** 安装到桌面：Chrome/Edge 的安装提示 */
  async function handleInstall() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast('已开始安装', { description: '装好后从桌面图标打开，就是独立窗口，不经过浏览器地址栏。' });
    } else if (outcome === 'dismissed') {
      toast('已取消安装');
    } else {
      toast('这个浏览器没有提供安装入口', {
        description: '可以手动在浏览器菜单里选「安装应用 / 添加到主屏幕」。',
      });
    }
  }

  /** 选一个文件作为自动备份目标（桌面浏览器） */
  async function chooseAutoTarget() {
    try {
      const name = await pickBackupTarget();
      if (!name) return;
      setAutoName(name);
      const res = await writeAutoBackup({ force: true, interactive: true });
      setAutoAt(autoBackupLastAt());
      toast(res === 'written' ? '自动备份已开启' : '已选好文件，但还没写入', {
        description: res === 'written' ? `之后数据变化会自动写进 ${name}` : '改完数据再点一次「立即写入」。',
      });
    } catch (e) {
      toast.error('没有选成文件', { description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function writeAutoNow() {
    setAutoBusy(true);
    try {
      const res = await writeAutoBackup({ force: true, interactive: true });
      setAutoAt(autoBackupLastAt());
      if (res === 'written') toast('已写入备份文件', { description: autoName ?? '' });
      else if (res === 'needs-permission') toast.error('需要重新授权', { description: '请重新选择一次备份文件。' });
      else if (res === 'no-target') toast('还没选备份文件');
      else if (res === 'unchanged') toast('内容没变，不需要重写');
      else toast.error('写入失败', { description: '文件可能被移动或删除，重新选一次。' });
    } finally {
      setAutoBusy(false);
    }
  }

  async function turnOffAuto() {
    await disableAutoBackup();
    setAutoName(null);
    setAutoAt(null);
    toast('已关闭自动备份', { description: '手动「导出备份」仍然可用。' });
  }

  /** App 内：直接写进手机「文档」目录 */
  async function exportToDevice() {
    setBusy(true);
    try {
      const res = await exportBackupToDevice();
      if (res.ok) {
        toast('已导出到手机', { description: res.path ?? res.message });
      } else {
        toast.error('导出失败', { description: res.message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[1280px] px-4 pb-24 lg:pb-10 pt-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          所有开关都只改这台机器上的数据：不登录、不上传，清了就是真没了。
        </p>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-4">
      <Fold title="思考方向与权重" defaultOpen>
        <p className="mb-3 text-xs text-muted-foreground">
          关掉一个方向，报告的对应区块就整段消失，不会留空壳。权重决定同优先级时谁排在前面。
        </p>
        <ul className="space-y-2">
          {directionRegistry.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">{AGENT_LABEL[a.id] ?? a.id}</div>
                <div className="text-xs text-muted-foreground">
                  权重 {a.defaultWeight} · 生存模式折算 ×{effectiveWeight(a.defaultWeight, 'exam', a.id).toFixed(1)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex items-center rounded-full border" data-weight={a.defaultWeight}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-r-none px-2 text-xs"
                    aria-label={`降低${AGENT_LABEL[a.id] ?? a.id}权重`}
                    onClick={() => bumpWeight(a.id, -0.5)}
                  >
                    −
                  </Button>
                  <span className="min-w-8 text-center text-xs tabular-nums" data-tick={weightTick}>
                    {a.defaultWeight}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-l-none px-2 text-xs"
                    aria-label={`提高${AGENT_LABEL[a.id] ?? a.id}权重`}
                    onClick={() => bumpWeight(a.id, 0.5)}
                  >
                    +
                  </Button>
                </div>
                <Button
                  variant={enabled[a.id] ? 'default' : 'outline'}
                  size="sm"
                  role="switch"
                  aria-checked={Boolean(enabled[a.id])}
                  onClick={() => toggleAgent(a.id)}
                >
                  {enabled[a.id] ? '已启用' : '已停用'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Fold>

      <Fold title="我的画像">
        <p className="mb-3 text-xs text-muted-foreground">
          {profile ? `${profile.identity.grade} · ${profile.identity.college}` : '尚未建档'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">餐标 元/月</span>
            <input
              inputMode="numeric"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">身高 cm</span>
            <input
              inputMode="numeric"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="选填"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">体重 kg</span>
            <input
              inputMode="numeric"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="选填"
            />
          </label>
        </div>
        <Button className="mt-3" size="sm" disabled={saving || !profile} onClick={() => void saveProfileEdits()}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </Fold>
        </div>

        <div className="space-y-4">
      <Fold title="外观" defaultOpen>
        <div className="flex gap-2">
          {(
            [
              ['system', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ] as const
          ).map(([v, label]) => (
            <Button key={v} variant={theme === v ? 'default' : 'outline'} size="sm" onClick={() => applyTheme(v)}>
              {label}
            </Button>
          ))}
        </div>
      </Fold>

      <Fold title="安装到桌面">
        {isStandalone() ? (
          <p className="text-xs text-muted-foreground">
            已经以独立窗口运行（从桌面图标打开），不用再装。
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              装到桌面后是全屏独立窗口，有图标、能离线打开，不再经过浏览器地址栏。数据仍然只在这台设备上。
            </p>
            {isIosSafari() ? (
              <p className="rounded-lg bg-muted/50 p-2 text-xs leading-relaxed">
                iPhone 上请用 Safari 打开本页 → 点底部「分享」→ 选「添加到主屏幕」。
              </p>
            ) : (
              <Button size="sm" variant={installable ? 'default' : 'outline'} onClick={() => void handleInstall()}>
                {installable ? '安装到桌面' : '查看安装方式'}
              </Button>
            )}
          </>
        )}
      </Fold>

      <Fold title="自动备份">
        <p className="mb-3 text-xs text-muted-foreground">
          选一个 JSON 文件，之后数据变化会自动写回它（桌面 Chrome / Edge 支持）。
          文件放在网盘目录就等于半自动同步。手机浏览器不允许后台写文件，用下面的「导出备份」。
        </p>
        {supportsAutoBackup() ? (
          <>
            <p className="mb-2 text-xs">
              当前文件：
              <span className="font-medium">{autoName ?? '还没选'}</span>
              {autoAt && (
                <span className="ml-2 text-muted-foreground">
                  上次写入 {new Date(autoAt).toLocaleString('zh-CN')}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={autoName ? 'outline' : 'default'} onClick={() => void chooseAutoTarget()}>
                {autoName ? '换一个文件' : '选择备份文件'}
              </Button>
              <Button size="sm" variant="outline" disabled={!autoName || autoBusy} onClick={() => void writeAutoNow()}>
                {autoBusy ? '写入中…' : '立即写入'}
              </Button>
              {autoName && (
                <Button size="sm" variant="ghost" onClick={() => void turnOffAuto()}>
                  关闭自动备份
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="rounded-lg bg-muted/50 p-2 text-xs leading-relaxed">
            当前浏览器不支持自动写文件（手机浏览器基本都不支持）。请用下一节的「导出备份」，
            导出的 JSON 可以随时导入回来。
          </p>
        )}
      </Fold>

      <Fold title="模型接入">
        <ModelSettings />
      </Fold>

      <Fold title="习惯画像">
        {traits ? (
          <>
            <p className="text-sm font-medium">
              {archetypeOf(traits).name}
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">{archetypeOf(traits).kind}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{traitsLine(traits)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              单块 {effectsOf(traits).focusMinutes} 分钟 · 提前 {effectsOf(traits).horizonDays} 天排 · 每天最多{' '}
              {effectsOf(traits).dayBudget} 分钟 · 优先{effectsOf(traits).preferSlot === 'morning' ? '上午' : '晚上'}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            还没测。12 道题、约 2 分钟，结果会直接改复习块长度、提前天数、每日配额和优先时段。
          </p>
        )}
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => {
            navigate('/assessment');
          }}
        >
          {traits ? '重新测评' : '开始测评'}
        </Button>
      </Fold>

      <Fold title="数据">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportBackup()}>
            导出备份
          </Button>
          {isNativeApp() && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportToDevice()}>
              存到手机文件
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            从备份导入
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={() => void wipeAll()}>
            清除全部本机数据
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importBackup(file);
          }}
        />
        <p className="mt-3 text-[11px] text-muted-foreground">
          备份是一个 JSON 文件（课表、睡眠、复习、收藏、偏好全在里面），不联网、不含密钥。
          导入会用备份覆盖本机数据，所以两边都会先确认。
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          当前版本构建于 {new Date(__BUILD_TIME__).toLocaleString('zh-CN')}
          {__BUILD_TIME__ ? '（看到的时间早于预期，说明 Service Worker 还没更新，刷新一次即可）' : ''}
        </p>
      </Fold>
        </div>
      </div>
    </div>
  );
}
