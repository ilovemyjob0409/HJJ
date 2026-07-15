import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export interface CreateTeacherInput {
  name: string;
  email: string;
  password: string;
  subjects: string;
  phone?: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export async function createTeacher(input: CreateTeacherInput) {
  const hashed = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, password: hashed, role: 'TEACHER' },
  });
  return prisma.teacher.create({
    data: { userId: user.id, subjects: input.subjects, phone: input.phone },
    select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } },
  });
}

export function listTeachers() {
  return prisma.teacher.findMany({
    select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } },
    orderBy: { user: { name: 'asc' } },
  });
}

// Narrower field set for students picking a teacher for a one-on-one makeup
// request (see src/app/student/makeup-request/page.tsx) — no phone or email.
export function listTeachersForBooking() {
  return prisma.teacher.findMany({
    select: { id: true, subjects: true, user: { select: { name: true } } },
    orderBy: { user: { name: 'asc' } },
  });
}
