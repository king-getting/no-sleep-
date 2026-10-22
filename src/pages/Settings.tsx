import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { agentRegistry } from '@/agents/registry';
import { clearAllData, getPreferences, getProfile, saveProfile } from '@/data/store/profile';
import { clearFeedState } from '@/data/store/feed';
import { bootMode, readAgentEnabled, resetBootMode, setBootMode, writeAgentEnabled } from '@/data/store/boot';
import { getThemeChoice, setTheme, type ThemeChoice } from '@/lib/theme';
import type { UserProfile } from '@/types/contract';

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
      const map: Record<string, boolean> = {};
      for (const a of agentRegistry) {
        // 持久化的值优先；未持久化时用注册表默认值
        if (persisted[a.id] !== undefined) a.enabled = persisted[a.id];
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
    resetBootMode();
    setBootMode('demo');
    window.location.reload();
  }

  async function wipeAll() {
    await clearAllData();
    await clearFeedState();
    resetBootMode();
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
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="mb-4 font-serif text-xl font-bold">设置</h1>

      <section className="mb-4 rounded-2xl border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Agent 启停</h2>
        <p className="mb-3 text-xs text-muted-foreground">关掉一个 Agent，报告的对应区块就整段消失，不会留空壳。</p>
        <ul className="space-y-2">
          {agentRegistry.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm">{AGENT_LABEL[a.id] ?? a.id}</div>
                <div className="text-xs text-muted-foreground">默认权重 {a.defaultWeight}</div>
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
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-4 rounded-2xl border bg-card p-4">
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

      <section className="mb-4 rounded-2xl border bg-card p-4">
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

      <section className="mb-4 rounded-2xl border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">演示旋钮</h2>
        <p className="mb-3 text-xs text-muted-foreground">示例考试是相对当前时间生成的，可能正好落在 7 天窗口里。</p>
        <Button variant={forceNormal ? 'default' : 'outline'} size="sm" onClick={toggleForceNormal}>
          {forceNormal ? '已强制关闭生存模式' : '强制关闭生存模式'}
        </Button>
      </section>

      <section className="mb-4 rounded-2xl border bg-card p-4">
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

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">数据</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          当前模式：{bootMode() === 'demo' ? '示例数据' : '我的真实录入'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void restoreDemo()}>
            恢复示例数据
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => void wipeAll()}>
            清除全部本机数据
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          清除后回到 30 秒建档流程；IndexedDB + localStorage 一并清空，不保留任何副本。
        </p>
      </section>
    </div>
  );
}
