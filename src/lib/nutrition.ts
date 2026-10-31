import type { MealNutrition } from '@/types/contract';

/**
 * 一餐的「结构」标签（契约 v1.7）。
 *
 * 刻意不含热量：食堂菜品没有可信的 kcal 来源，编一个数字写进产品比不写更糟。
 * 三级标签 + 一句「不改选择也能改的小动作」，比一个精确到个位的热量值更可能被照做。
 */

const VEG = ['没有蔬菜', '蔬菜偏少', '蔬菜到位'] as const;
const PROTEIN = ['蛋白偏少', '蛋白够', '蛋白充足'] as const;
const OIL = ['油偏重', '油适中', '油偏轻'] as const;

export function vegText(n: MealNutrition): string {
  return VEG[n.veg];
}
export function proteinText(n: MealNutrition): string {
  return PROTEIN[n.protein];
}
export function oilText(n: MealNutrition): string {
  return OIL[n.oil];
}

/** 「蔬菜没有 · 蛋白够 · 油偏重」——按 蔬菜 / 蛋白 / 油 的顺序，短的在前 */
export function nutritionLabel(n: MealNutrition): string {
  return [VEG[n.veg], PROTEIN[n.protein], OIL[n.oil]].join(' · ');
}

/** 一条「不改选择也能改」的小动作；没有可说的就返回 null，不硬凑 */
export function nutritionTip(n: MealNutrition): string | null {
  if (n.veg === 0) return '加一份青菜，通常多花 2–3 元';
  if (n.veg === 1) return '再添半份素菜就够了';
  if (n.oil === 0) return '把炸的换成烧的，同样的量少一半油';
  if (n.protein === 0) return '加一个蛋或一份豆制品，比加主食划算';
  return null;
}

/** 0–6 分，只用于横向比较（越高越好），不是营养评分 */
export function nutritionScore(n: MealNutrition): number {
  return n.veg + n.protein + n.oil;
}
