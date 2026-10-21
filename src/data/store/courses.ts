import { db } from './db';
import { ensureSeeded } from './profile';
import type { Course, ExamItem } from '@/types/contract';

/**
 * 课表 / 考试的 CRUD 接口（A3）
 * 数据只存本地 IndexedDB；B 侧的录入界面、未来的教务 adapter 都走这层。
 */

// ── 课程 ────────────────────────────────────────────────────

export async function listCourses(): Promise<Course[]> {
  await ensureSeeded();
  return db.courses.toArray();
}

export async function addCourse(course: Course): Promise<void> {
  await ensureSeeded();
  await db.courses.put(course);
}

export async function updateCourse(id: string, patch: Partial<Omit<Course, 'id'>>): Promise<void> {
  await db.courses.update(id, patch);
}

export async function deleteCourse(id: string): Promise<void> {
  await db.courses.delete(id);
}

// ── 考试 / DDL ──────────────────────────────────────────────

export async function listExams(): Promise<ExamItem[]> {
  await ensureSeeded();
  return (await db.exams.toArray()).sort((a, b) => a.at.localeCompare(b.at));
}

export async function addExam(exam: ExamItem): Promise<void> {
  await ensureSeeded();
  await db.exams.put(exam);
}

export async function updateExam(id: string, patch: Partial<Omit<ExamItem, 'id'>>): Promise<void> {
  await db.exams.update(id, patch);
}

export async function deleteExam(id: string): Promise<void> {
  await db.exams.delete(id);
}
