import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export interface CreateTeacherInput {
  name: string;
  email: string;
  password: string;
  subjects: string;
  phone?: string;
}

export interface UpdateTeacherInput {
  name?: string;
  email?: string;
  password?: string;
  subjects?: string;
  phone?: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export async function createTeacher(input: CreateTeacherInput) {
  const hashed = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email.trim().toLowerCase(), password: hashed, role: 'TEACHER' },
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

export async function updateTeacher(id: string, input: UpdateTeacherInput) {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id } });
  const hashedPassword = input.password ? await bcrypt.hash(input.password, 10) : undefined;

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: teacher.userId },
      data: { name: input.name, email: input.email?.trim().toLowerCase(), password: hashedPassword },
    });
    return tx.teacher.update({
      where: { id },
      data: { subjects: input.subjects, phone: input.phone },
      select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } },
    });
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

// Blocks deletion when the teacher still has classes assigned, or has
// substitute-request history as the original teacher — both are required
// references (a class must have a teacher, an original-teacher record
// must survive). Availability is current state, not history, so it's
// cleared as part of the delete, along with the underlying login
// account. Optional references (one-on-one makeup requests, substitute
// assignments) keep their own row but lose the teacher link.
export async function deleteTeacher(id: string) {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id } });
  const [classCount, originalSubstituteCount] = await Promise.all([
    prisma.class.count({ where: { teacherId: id } }),
    prisma.substituteRequest.count({ where: { originalTeacherId: id } }),
  ]);
  if (classCount > 0 || originalSubstituteCount > 0) {
    throw new Error('TEACHER_HAS_RECORDS');
  }

  await prisma.$transaction([
    prisma.teacherAvailability.deleteMany({ where: { teacherId: id } }),
    prisma.makeupRequest.updateMany({ where: { teacherId: id }, data: { teacherId: null } }),
    prisma.substituteRequest.updateMany({ where: { substituteTeacherId: id }, data: { substituteTeacherId: null } }),
    prisma.teacher.delete({ where: { id } }),
    prisma.user.delete({ where: { id: teacher.userId } }),
  ]);
}
