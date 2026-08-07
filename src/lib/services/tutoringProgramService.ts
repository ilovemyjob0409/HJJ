import { prisma } from '@/lib/db';

export interface CreateProgramInput {
  name: string;
  defaultMonthlyQuota?: number;
  defaultDurationMinutes?: number;
}

export function createProgram(input: CreateProgramInput) {
  return prisma.tutoringProgram.create({
    data: {
      name: input.name,
      defaultMonthlyQuota: input.defaultMonthlyQuota ?? 8,
      defaultDurationMinutes: input.defaultDurationMinutes ?? 120,
    },
  });
}

export function listPrograms() {
  return prisma.tutoringProgram.findMany({
    include: { windows: { include: { teacher: { select: { user: { select: { name: true } } } }, closures: true } } },
    orderBy: { name: 'asc' },
  });
}

export interface UpdateProgramInput {
  name?: string;
  defaultMonthlyQuota?: number;
  defaultDurationMinutes?: number;
  active?: boolean;
}

export function updateProgram(id: string, input: UpdateProgramInput) {
  return prisma.tutoringProgram.update({ where: { id }, data: input });
}

export function deleteProgram(id: string) {
  return prisma.tutoringProgram.delete({ where: { id } });
}

export interface CreateWindowInput {
  programId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  teacherId: string;
}

export function createWindow(input: CreateWindowInput) {
  return prisma.tutoringWindow.create({ data: input });
}

export interface UpdateWindowInput {
  weekday?: number;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  teacherId?: string;
  active?: boolean;
}

export function updateWindow(id: string, input: UpdateWindowInput) {
  return prisma.tutoringWindow.update({ where: { id }, data: input });
}

export function deleteWindow(id: string) {
  return prisma.tutoringWindow.delete({ where: { id } });
}

export function addWindowClosure(windowId: string, date: Date) {
  return prisma.tutoringWindowClosure.create({ data: { windowId, date } });
}

export function deleteWindowClosure(id: string) {
  return prisma.tutoringWindowClosure.delete({ where: { id } });
}
