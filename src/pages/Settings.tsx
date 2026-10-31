import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { agentRegistry } from '@/agents/registry';
import { clearAllData, getPreferences, getProfile, saveProfile } from '@/data/store/profile';
import { clearFeedState } from '@/data/store/feed';
import { bootMode, clearLocalPrefs, readAgentEnabled, readAgentWeights, setBootMode, writeAgentEnabled, writeAgentWeights } from '@/data/store/boot';
import { getThemeChoice, setTheme, type ThemeChoice } from '@/lib/theme';
import { effectiveWeight } from '@/orchestrator/weights';
import type { AgentId, UserProfile } from '@/types/contract';

/**
 * 设置页（dev-tasks B7 + B9 的外观开关 + A6 的演示旋钮）
 *
 * 四组能力：
 *   1. Agent 逐个启停 —— 直接改注册表 enabled 并持久化，关掉健康 Agent 后下一轮报告不含健康建议
 *   2. 画像编辑 —— 餐标 / 身体基线 / 校区（身份主力在 onboarding，这里只补常用项）
 *   3. 数据 —— 恢复示例数据 / 清除全部本机数据（回到 onboarding）
 *   4. 演示旋钮 —— 强制关闭生存模式（示例考试可能正好落在 7 天内，路演需要能控）
 */

const FORCE_NORMAL_KEY = 'xiaoshan:force-normal';
const LLM_KEY = 'xiaoshan:llm-key';

const AGENT_LABEL: Record<string, string> = {
  academic: '教务 Agent',
  life: '生活 Agent',
  health: '健康 Agent',
  schedule: '日程 Agent',
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
  const [llmKey, setLlmKey] = useState('');
  const [saving, setSaving] = useState(false);

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
      setLlmKey(localStorage.getItem(LLM_KEY) ?? '');
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

  async function restoreDemo() {
    await clearAllData();
    await clearFeedState();
    // resetBootMode 只清 3 个开关；这里连凭据/强制开关一起按命名空间清掉
    clearLocalPrefs();
    setBootMode('demo');
    window.location.reload();
  }

  async function wipeAll() {
    await clearAllData();
    await clearFeedState();
    clearLocalPrefs();
    setBootMode('real');
    window.location.reload();
  }

  function applyTheme(next: ThemeChoice) {
    setTheme(next);
    setThemeState(next);
  }

  function toggleForceNormal() {
    const next = !forceNormal;
    setForceNormal(next);
    localStorage.setItem(FORCE_NORMAL_KEY, next ? '1' : '0');
    toast(next ? '已强制关闭生存模式' : '生存模式按考试自动判定', {
      description: '路演时用它切「普通报告 / 冲刺报告」两种形态。',
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
        <h2 className="mb-1 text-sm font-semibold">Agent 启停与权重</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          关掉一个 Agent，报告的对应区块就整段消失，不会留空壳。权重决定同优先级时谁排在前面。
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
        <p className="mb-3 text-xs text-muted-foreground">示例考试是相对当前时间生成的，可能正好落在 7 天窗口里。</p>
        <Button variant={forceNormal ? 'default' : 'outline'} size="sm" onClick={toggleForceNormal}>
          {forceNormal ? '已强制关闭生存模式' : '强制关闭生存模式'}
        </Button>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">模型（选填）</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          本期报告由本地规则生成，不调用任何大模型；此处 key 只存在浏览器 localStorage。
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            placeholder="sk-…（可留空）"
            value={llmKey}
            onChange={(e) => setLlmKey(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              localStorage.setItem(LLM_KEY, llmKey);
              toast('已保存到本机', { description: '不会发送到任何服务器。' });
            }}
          >
            保存
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">数据</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          当前模式：{bootMode() === 'demo' ? '示例数据' : '我的真实录入'}
        </p>
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                恢复示例数据
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>恢复成示例数据？</AlertDialogTitle>
                <AlertDialogDescription>
                  本机记录的真实课表、睡眠、点选与复习草案都会被清空，换成示例数据。这一步不能撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void restoreDemo()}>恢复</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive">
                清除全部本机数据
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清除全部本机数据？</AlertDialogTitle>
                <AlertDialogDescription>
                  课表、考试、睡眠、点选记录、信息流反馈与复习草案会一并删除，并回到建档流程。这一步不能撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => void wipeAll()}
                >
                  清除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          清除后回到 30 秒建档流程；IndexedDB（含复习草案与信息流收藏）+ localStorage 的 xiaoshan:* 键一并清空，不保留任何副本。
        </p>
      </section>
        </div>
      </div>
    </div>
  );
}
