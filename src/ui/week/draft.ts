import type { Course } from '@/types/contract';
import type { CourseDraft } from './CourseSheet';

/** 构造「点空白新建」时的默认草稿。 */
export function makeDraft(dow: number, startMin: number, endMin: number): CourseDraft {
  const snapped = Math.max(0, Math.min(24 * 60 - 60, Math.round(startMin / 5) * 5));
  const span = endMin - startMin >= 40 ? Math.min(endMin - startMin, 180) : 100;
  return {
    mode: 'add',
    course: {
      id: '',
      name: '',
      location: '',
      dayOfWeek: dow as Course['dayOfWeek'],
      startMin: snapped,
      endMin: Math.min(snapped + span, 23 * 60 + 59),
    },
    siblings: [],
  };
}
