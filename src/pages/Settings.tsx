import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ModelSettings from '@/ui/settings/ModelSettings';
import { agentRegistry } from '@/agents/registry';
import { db } from '@/data/store/db';
import { clearAllData, getPreferences, getProfile, saveProfile } from '@/data/store/profile';
import { clearFeedState } from '@/data/store/feed';
import { downloadBackup, restoreBackup } from '@/data/store/backup';
import { bootMode, clearLocalPrefs, readAgentEnabled, readAgentWeights, resetBootMode, setBootMode, writeAgentEnabled, writeAgentWeights } from '@/data/store/boot';
import { getThemeChoice, setTheme, type ThemeChoice } from '@/lib/theme';
import { effectiveWeight } from '@/orchestrator/weights';
import { archetypeOf, effectsOf, traitsLine } from '@/lib/assessment';
import type { AgentId, HabitTraits, UserProfile } from '@/types/contract';

/**
 * 设置页（dev-tasks B7 + B9 的外观开关 + A6 的演示旋钮）
 *
 * 四组能力：
 *   1. 思考方向逐个启停 —— 直接改注册表 enabled 并持久化，关掉健康 Agent 后下一轮报告不含健康建议
 *   2. 画像编辑 —— 餐标 / 身体基线 / 校区（身份主力在 onboarding，这里只补常用项）
 *   3. 数据 —— 恢复示例数据 / 清除全部本机数据（回到 onboarding）
 *   4. 演示旋钮 —— 强制关闭生存模式（示例考试可能正好落在 7 天内，演示需要能控）
 */

const FORCE_NORMAL_KEY = 'xiaoshan:force-normal';

const AGENT_LABEL: Record<string, string> = {
  academic: '学习视角',
  life: '生活视角',
  health: '健康视角',
  schedule: '日程视角',
};

export default function Settings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [budget, setBudget] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [weightTick, setWeightTick] = useState(0);
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [forceNormal, setForceNormal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [traits, setTraits] = useState<HabitTraits | null>(null);
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
      const persisted = readAgentEnabled();
      const weights = readAgentWeights();
      const map: Record<string, boolean> = {};
      for (const a of agentRegistry) {
        // 持久化的值优先；未持久化时用注册表默认值
        if (persisted[a.id] !== undefined) a.enabled = persisted[a.id];
        if (weights[a.id] !== undefined) a.defaultWeight = weights[a.id];
        map[a.id] = a.enabled;
      }
      setEnabled(map);
      setThemeState(getThemeChoice());
      setForceNormal(localStorage.getItem(FORCE_NORMAL_KEY) === '1');
      const prefs = await getPreferences().catch(() => null);
      setTraits(prefs?.traits ?? null);
    })();
  }, []);

  function toggleAgent(id: string) {
    const next = !enabled[id];
    const map = { ...enabled, [id]: next };
    setEnabled(map);
    const agent = agentRegistry.find((a) => a.id === id);
    if (agent) agent.enabled = next;
    writeAgentEnabled(map);
    toast(next ? `已启用${AGENT_LABEL[id] ?? id}` : `已停用${AGENT_LABEL[id] ?? id}`, {
      description: '下一份报告生效；历史报告不变。',
    });
  }

  /** 权重档位：0.5–3，步进 0.5。改的是注册表单例 + localStorage，下一轮报告生效 */
  function bumpWeight(id: AgentId, delta: number) {
    const agent = agentRegistry.find((a) => a.id === id);
    if (!agent) return;
    const next = Math.min(3, Math.max(0.5, Math.round((agent.defaultWeight + delta) * 10) / 10));
    if (next === agent.defaultWeight) return;
    agent.defaultWeight = next;
    const map: Record<string, number> = {};
    for (const a of agentRegistry) map[a.id] = a.defaultWeight;
    writeAgentWeights(map);
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

  async function restoreDemo() {
    if (!window.confirm('恢复示例数据会覆盖当前内容。要先把现在的数据导出备份吗？\n\n确定覆盖并进入示例模式？')) return;
    await clearAllData();
    await clearFeedState();
    resetBootMode();
    // resetBootMode 只清 3 个开关；凭据、强制模式这些后加的键按命名空间一起清掉
    clearLocalPrefs();
    setBootMode('demo');
    window.location.reload();
  }

  async function wipeAll() {
    if (!window.confirm('将清空这台设备上的全部数据：课表、考试、睡眠、复习草案、收藏与偏好。\n\n这一步不可撤销，确定继续？')) return;
    await clearAllData();
    await clearFeedState();
    resetBootMode();
    // resetBootMode 只清 3 个开关；凭据、强制模式这些后加的键按命名空间一起清掉
    clearLocalPrefs();
    setBootMode('real');
    window.location.reload();
  }

  function applyTheme(next: ThemeChoice) {
    setTheme(next);
    setThemeState(next);
  }

  /** 演示用：把示例考试挪到 3 天后，报告立刻切成冲刺模式 */
  async function mockExamWeek() {
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await db.exams.put({ id: 'exam-ds', title: '数据结构期中考试', kind: 'exam', at, mastery: 3 });
    localStorage.setItem(FORCE_NORMAL_KEY, '0');
    toast('示例考试已挪到 3 天后', { description: '重载后报告切成冲刺模式。' });
    window.setTimeout(() => window.location.reload(), 700);
  }

  function toggleForceNormal() {    const next = !forceNormal;
    setForceNormal(next);
    localStorage.setItem(FORCE_NORMAL_KEY, next ? '1' : '0');
    toast(next ? '已强制关闭生存模式' : '生存模式按考试自动判定', {
      description: '想在普通报告和冲刺报告之间对照时，用这个开关。',
    });
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
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">思考方向与权重</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          关掉一个方向，报告的对应区块就整段消失，不会留空壳。权重决定同优先级时谁排在前面。
        </p>
        <ul className="space-y-2">
          {agentRegistry.map((a) => (
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
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">我的画像</h2>
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
      </section>
        </div>

        <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">外观</h2>
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
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">演示旋钮</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          示例考试默认在 12 天后，所以打开是「平时报告」。想看生存模式，把它挪到考前一周。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void mockExamWeek()}>
            演示：考前一周（看冲刺报告）
          </Button>
          <Button variant={forceNormal ? 'default' : 'outline'} size="sm" onClick={toggleForceNormal}>
            {forceNormal ? '已强制关闭生存模式' : '强制关闭生存模式'}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">习惯画像</h2>
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
            window.location.href = '/assessment';
          }}
        >
          {traits ? '重新测评' : '开始测评'}
        </Button>
      </section>

      <ModelSettings />

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">数据</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          当前模式：{bootMode() === 'demo' ? '示例数据' : '我的真实录入'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportBackup()}>
            导出备份
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            从备份导入
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void restoreDemo()}>
            恢复示例数据
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
      </section>
        </div>
      </div>
    </div>
  );
}
