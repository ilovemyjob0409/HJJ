import { prisma } from '@/lib/db';

export function listFeeTiers() {
  return prisma.tutoringFeeTier.findMany({ orderBy: { sortOrder: 'asc' } });
}

export function createFeeTier(input: { name: string; sessionsPerWeek: number; monthlyFee: number }) {
  return prisma.tutoringFeeTier.create({ data: { ...input, sortOrder: input.sessionsPerWeek * -1 } });
}

export function updateFeeTier(id: string, input: { name?: string; sessionsPerWeek?: number; monthlyFee?: number }) {
  return prisma.tutoringFeeTier.update({ where: { id }, data: input });
}

export async function deleteFeeTier(id: string): Promise<void> {
  const inUse = await prisma.tutoringEnrollment.count({ where: { feeTierId: id } });
  if (inUse > 0) throw new Error('TIER_IN_USE');
  await prisma.tutoringFeeTier.delete({ where: { id } });
}

// 預設級距：一週兩堂 3000／一週一堂 1500（表空時才建）
export async function seedDefaultFeeTiers(): Promise<void> {
  const count = await prisma.tutoringFeeTier.count();
  if (count > 0) return;
  await prisma.tutoringFeeTier.createMany({
    data: [
      { name: '一週兩堂', sessionsPerWeek: 2, monthlyFee: 3000, sortOrder: 0 },
      { name: '一週一堂', sessionsPerWeek: 1, monthlyFee: 1500, sortOrder: 1 },
    ],
  });
}

export async function setEnrollmentFeeTier(enrollmentId: string, feeTierId: string | null): Promise<void> {
  await prisma.tutoringEnrollment.update({ where: { id: enrollmentId }, data: { feeTierId } });
}

// 批量指定收費級距：單一 updateMany，不逐筆 update（避免 N 次序列查詢）。
export async function batchSetFeeTier(enrollmentIds: string[], feeTierId: string | null): Promise<number> {
  const result = await prisma.tutoringEnrollment.updateMany({
    where: { id: { in: enrollmentIds } },
    data: { feeTierId },
  });
  return result.count;
}
