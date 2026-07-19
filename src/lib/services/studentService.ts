import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export interface CreateStudentInput {
  name: string;
  email: string;
  password: string;
  parentPhone?: string;
}

export interface UpdateStudentInput {
  name?: string;
  email?: string;
  password?: string;
  parentPhone?: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export async function createStudent(input: CreateStudentInput) {
  const hashed = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, password: hashed, role: 'STUDENT' },
  });
  return prisma.student.create({
    data: { userId: user.id, parentPhone: input.parentPhone },
    select: { id: true, parentPhone: true, user: { select: SAFE_USER_SELECT } },
  });
}

export function listStudents() {
  return prisma.student.findMany({
    select: { id: true, parentPhone: true, user: { select: SAFE_USER_SELECT } },
    orderBy: { user: { name: 'asc' } },
  });
}

export async function updateStudent(id: string, input: UpdateStudentInput) {
  const student = await prisma.student.findUniqueOrThrow({ where: { id } });
  const hashedPassword = input.password ? await bcrypt.hash(input.password, 10) : undefined;

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: student.userId },
      data: { name: input.name, email: input.email, password: hashedPassword },
    });
    return tx.student.update({
      where: { id },
      data: { parentPhone: input.parentPhone },
      select: { id: true, parentPhone: true, user: { select: SAFE_USER_SELECT } },
    });
  });
}
