import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { db } from '@/data/store/db';
import { savePreferences, saveProfile } from '@/data/store/profile';
import { setBootMode } from '@/data/store/boot';
import { MOCK_COURSES } from '@/data/mock/courses';
import type { Campus, Preferences, UserProfile } from '@/types/contract';

/**
 * Onboarding（dev-tasks B1 / 设计文档 §4.9）
 *
 * 7 屏：隐私承诺 → 身份 → 身体基线 → 课表 → 餐标 → 偏好 3 题 → 画像卡回显。
 * 纪律：除身份外每屏都可「跳过」，跳过即用默认值，绝不把用户卡在表单里。
 * 没有任何网络请求；写入走 store 层（saveProfile / savePreferences），页面不直接摸 db 以外的东西。
 */

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const COLLEGES = [
  '计算机学院',
  '数学与统计学院',
  '物理科学与技术学院',
  '文学院',
  '外国语学院',
  '教育学院',
  '心理学院',
  '经济与工商管理学院',
  '其他学院',
];

const GRADES: Record<'undergrad' | 'grad', string[]> = {
  undergrad: ['大一', '大二', '大三', '大四'],
  grad: ['研一', '研二', '研三'],
};

const CAMPUS_LABEL: Record<Campus, string> = { guizishan: '桂子山校区', nanhu: '南湖校区' };

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-6 rounded-full ${i <= step ? 'bg-primary' : 'bg-muted'}`}
        />
      ))}
    </div>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>(0);

  // 身份（唯一必填）
  const [level, setLevel] = useState<'undergrad' | 'grad'>('undergrad');
  const [grade, setGrade] = useState('大二');
  const [college, setCollege] = useState('计算机学院');
  const [campus, setCampus] = useState<Campus>('guizishan');

  // 身体基线（知情选填）
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');

  // 课表
  const [withCourses, setWithCourses] = useState(true);

  // 餐标
  const [mealBudget, setMealBudget] = useState('1200');

  // 偏好 3 题
  const [chronotype, setChronotype] = useState<Preferences['chronotype']>('early');
  const [foodPriority, setFoodPriority] = useState<Preferences['foodPriority']>('food');
  const [napHabit, setNapHabit] = useState<Preferences['napHabit']>('sometimes');

  const [saving, setSaving] = useState(false);

  const profile: UserProfile = {
    id: 'me',
    identity: { level, grade, college, campus },
    mealBudgetMonthly: Number(mealBudget) || 1200,
    bodyBaseline:
      heightCm || weightKg
        ? { heightCm: heightCm ? Number(heightCm) : undefined, weightKg: weightKg ? Number(weightKg) : undefined }
        : undefined,
    isDemo: false,
  };

  async function finish() {
    setSaving(true);
    try {
      const prefs: Preferences = { chronotype, foodPriority, napHabit, compliance: {}, conflictChoices: {} };
      await saveProfile(profile);
      await savePreferences(prefs);
      if (withCourses) await db.courses.bulkPut(MOCK_COURSES);
      setBootMode('real'); // 从此不再自动灌示例数据
      toast('画像已保存在这台设备上', { description: '数据只存本地 IndexedDB，不上传任何服务器。' });
      onDone();
    } catch (err) {
      toast('保存失败', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-xl font-bold">小山 · 30 秒建档</h1>
        <StepDots step={step} />
      </div>

      <div className="flex-1 space-y-5 rounded-2xl border bg-card p-6 shadow-xs">
        {step === 0 && (
          <section className="space-y-4">
            <h2 className="font-serif text-lg font-semibold">先说清楚隐私</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>· 课表、睡眠、点选记录只存在这台设备的 IndexedDB 里</li>
              <li>· 没有账号，没有云同步，拔掉网线照样能用</li>
              <li>· 随时可以在设置里一键清除全部数据</li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => setStep(1)}>开始建档</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setBootMode('demo');
                  onDone();
                }}
              >
                先用示例数据看看
              </Button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4">
            <h2 className="font-serif text-lg font-semibold">你是哪一级、哪个学院</h2>
            <div className="flex gap-2">
              {(['undergrad', 'grad'] as const).map((v) => (
                <Button
                  key={v}
                  variant={level === v ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setLevel(v);
                    setGrade(GRADES[v][0]);
                  }}
                >
                  {v === 'undergrad' ? '本科生' : '研究生'}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {GRADES[level].map((g) => (
                <Button key={g} variant={grade === g ? 'default' : 'outline'} size="sm" onClick={() => setGrade(g)}>
                  {g}
                </Button>
              ))}
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">学院</span>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={college}
                onChange={(e) => setCollege(e.target.value)}
              >
                {COLLEGES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              {(Object.keys(CAMPUS_LABEL) as Campus[]).map((c) => (
                <Button key={c} variant={campus === c ? 'default' : 'outline'} size="sm" onClick={() => setCampus(c)}>
                  {CAMPUS_LABEL[c]}
                </Button>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                上一步
              </Button>
              <Button onClick={() => setStep(2)}>下一步</Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <h2 className="font-serif text-lg font-semibold">身体基线（可不填）</h2>
            <p className="text-sm text-muted-foreground">
              只用来判断「睡眠时长够不够」这类问题，不用于任何评分或排行榜。
            </p>
            <div className="flex gap-3">
              <label className="flex-1 space-y-1 text-sm">
                <span className="text-muted-foreground">身高 cm</span>
                <input
                  inputMode="numeric"
                  className="w-full rounded-md border bg-background px-3 py-2"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="选填"
                />
              </label>
              <label className="flex-1 space-y-1 text-sm">
                <span className="text-muted-foreground">体重 kg</span>
                <input
                  inputMode="numeric"
                  className="w-full rounded-md border bg-background px-3 py-2"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  placeholder="选填"
                />
              </label>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                上一步
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)}>
                  跳过
                </Button>
                <Button onClick={() => setStep(3)}>下一步</Button>
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4">
            <h2 className="font-serif text-lg font-semibold">课表怎么来</h2>
            <p className="text-sm text-muted-foreground">
              这学期还没有真实教务源，先二选一；之后可以在设置里逐条增删。
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setWithCourses(true)}
                className={`w-full rounded-xl border p-3 text-left text-sm ${withCourses ? 'border-primary bg-primary/5' : ''}`}
              >
                <div className="font-medium">先导入示例课表（推荐）</div>
                <div className="text-muted-foreground">含早八、连排、午休被吃掉的真实形态，便于立刻看到报告效果</div>
              </button>
              <button
                type="button"
                onClick={() => setWithCourses(false)}
                className={`w-full rounded-xl border p-3 text-left text-sm ${!withCourses ? 'border-primary bg-primary/5' : ''}`}
              >
                <div className="font-medium">空课表，我自己加</div>
                <div className="text-muted-foreground">报告会以「今天没课」为起点，时间块变为整天空档</div>
              </button>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                上一步
              </Button>
              <Button onClick={() => setStep(4)}>下一步</Button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-4">
            <h2 className="font-serif text-lg font-semibold">一个月吃饭大概花多少</h2>
            <div className="flex items-center gap-3">
              <input
                inputMode="numeric"
                className="w-32 rounded-md border bg-background px-3 py-2 text-sm"
                value={mealBudget}
                onChange={(e) => setMealBudget(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">元 / 月（默认 1200）</span>
            </div>
            <p className="text-sm text-muted-foreground">
              只影响食堂建议里的「这个窗口在不在你的日均预算内」，不做消费统计。
            </p>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(3)}>
                上一步
              </Button>
              <Button onClick={() => setStep(5)}>下一步</Button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="space-y-5">
            <h2 className="font-serif text-lg font-semibold">三个快问快答</h2>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">你更像哪种作息？</div>
              <div className="flex gap-2">
                <Button variant={chronotype === 'early' ? 'default' : 'outline'} size="sm" onClick={() => setChronotype('early')}>
                  早起型
                </Button>
                <Button variant={chronotype === 'night' ? 'default' : 'outline'} size="sm" onClick={() => setChronotype('night')}>
                  夜猫型
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">食堂选窗口时最在意什么？</div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['food', '好吃'],
                    ['saving', '省钱'],
                    ['health', '健康'],
                  ] as const
                ).map(([v, label]) => (
                  <Button key={v} variant={foodPriority === v ? 'default' : 'outline'} size="sm" onClick={() => setFoodPriority(v)}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">中午有午休习惯吗？</div>
              <div className="flex gap-2">
                {(
                  [
                    ['always', '固定午休'],
                    ['sometimes', '看情况'],
                    ['never', '不午休'],
                  ] as const
                ).map(([v, label]) => (
                  <Button key={v} variant={napHabit === v ? 'default' : 'outline'} size="sm" onClick={() => setNapHabit(v)}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(4)}>
                上一步
              </Button>
              <Button onClick={() => setStep(6)}>看我的画像</Button>
            </div>
          </section>
        )}

        {step === 6 && (
          <section className="space-y-4">
            <h2 className="font-serif text-lg font-semibold">这是我们对你的理解</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">身份</dt>
                <dd>
                  {grade} · {college} · {CAMPUS_LABEL[campus]}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">身体基线</dt>
                <dd>{heightCm || weightKg ? `${heightCm || '—'}cm / ${weightKg || '—'}kg` : '未填（不影响使用）'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">课表</dt>
                <dd>{withCourses ? `已导入 ${MOCK_COURSES.length} 条示例课程` : '空课表'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">餐标</dt>
                <dd>{profile.mealBudgetMonthly} 元 / 月（日均约 {Math.round(profile.mealBudgetMonthly / 30)} 元）</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">偏好</dt>
                <dd>
                  {chronotype === 'early' ? '早起型' : '夜猫型'} ·{' '}
                  {foodPriority === 'food' ? '好吃优先' : foodPriority === 'saving' ? '省钱优先' : '健康优先'} ·{' '}
                  {napHabit === 'always' ? '固定午休' : napHabit === 'sometimes' ? '看情况午休' : '不午休'}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              这些都能在设置里改；任何一个 ✗ 都不用重来一遍流程。
            </p>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(5)}>
                改一下
              </Button>
              <Button disabled={saving} onClick={() => void finish()}>
                {saving ? '保存中…' : '就用这个'}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
