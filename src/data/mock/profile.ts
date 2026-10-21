import type { Preferences, UserProfile } from '@/types/contract';

/**
 * 示例用户画像（onboarding 收尾产出的「个人画像卡」的演示版本）
 * isDemo=true：带明显的「示例数据」标签，可一键清除退出。
 */
export const DEMO_PROFILE: UserProfile = {
  id: 'me',
  identity: {
    level: 'undergrad',
    grade: '大二',
    college: '计算机学院',
    major: '计算机科学与技术',
    campus: 'guizishan',
  },
  mealBudgetMonthly: 750, // 日均 ¥25
  bodyBaseline: { heightCm: 172, weightKg: 63 },
  isDemo: true,
};

/** 偏好快问快答（§4.9 第 5 步）的示例答案，作为各 Agent 初始权重 */
export const DEMO_PREFERENCES: Preferences = {
  chronotype: 'night', // 夜猫型
  foodPriority: 'saving', // 省钱优先
  napHabit: 'sometimes',
  compliance: {},
  conflictChoices: {},
};
