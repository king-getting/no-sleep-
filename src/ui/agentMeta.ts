import { BookOpen, CalendarClock, HeartPulse, UtensilsCrossed } from 'lucide-react';
import type { AgentId } from '@/types/contract';

/**
 * Agent 视觉（§13.2）：山绿色系深浅区分 + 各自小图标
 */
export const AGENT_META: Record<AgentId, { name: string; color: string; bg: string; icon: typeof BookOpen }> = {
  academic: { name: '教务', color: 'text-[#2F4F43]', bg: 'bg-[#2F4F43]', icon: BookOpen },
  life: { name: '生活', color: 'text-[#4A6B5C]', bg: 'bg-[#4A6B5C]', icon: UtensilsCrossed },
  health: { name: '健康', color: 'text-[#6B8F7E]', bg: 'bg-[#6B8F7E]', icon: HeartPulse },
  schedule: { name: '日程', color: 'text-[#8FAF9F]', bg: 'bg-[#8FAF9F]', icon: CalendarClock },
};
