import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { createProgram } from './tutoringProgramService';
import {
  listFeeTiers, createFeeTier, updateFeeTier, deleteFeeTier, seedDefaultFeeTiers, setEnrollmentFeeTier, batchSetFeeTier,
} from './tutoringFeeTierService';

describe('tutoringFeeTierService', () => {
  it('seeds defaults once, lists in sort order', async () => {
    await seedDefaultFeeTiers();
    await seedDefaultFeeTiers(); // 冪等
    const tiers = await listFeeTiers();
    expect(tiers.map((t) => [t.name, t.monthlyFee])).toEqual([
      ['一週兩堂', 3000],
      ['一週一堂', 1500],
    ]);
  });

  it('creates, updates, and blocks deleting a tier in use', async () => {
    const tier = await createFeeTier({ name: '一週三堂', sessionsPerWeek: 3, monthlyFee: 4200 });
    await updateFeeTier(tier.id, { monthlyFee: 4500 });
    expect((await listFeeTiers()).find((t) => t.id === tier.id)?.monthlyFee).toBe(4500);

    const student = await createStudent({ name: '小明', email: 'tier-ming@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    await setEnrollmentFeeTier(enrollment.id, tier.id);
    await expect(deleteFeeTier(tier.id)).rejects.toThrow('TIER_IN_USE');

    await setEnrollmentFeeTier(enrollment.id, null);
    await deleteFeeTier(tier.id); // 解除引用後可刪
  });

  it('batchSetFeeTier updates only the given enrollments, leaving others untouched', async () => {
    const tier = await createFeeTier({ name: '一週兩堂B', sessionsPerWeek: 2, monthlyFee: 3200 });
    const program = await createProgram({ name: '數學個別輔導' });
    const s1 = await createStudent({ name: '小華', email: 'tier-hua@example.com', password: 'x' });
    const s2 = await createStudent({ name: '小美', email: 'tier-mei@example.com', password: 'x' });
    const s3 = await createStudent({ name: '小強', email: 'tier-chiang@example.com', password: 'x' });
    const e1 = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s1.id } });
    const e2 = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s2.id } });
    const e3 = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s3.id } });

    const count = await batchSetFeeTier([e1.id, e2.id], tier.id);
    expect(count).toBe(2);

    const rows = await prisma.tutoringEnrollment.findMany({ where: { id: { in: [e1.id, e2.id, e3.id] } } });
    expect(rows.find((r) => r.id === e1.id)?.feeTierId).toBe(tier.id);
    expect(rows.find((r) => r.id === e2.id)?.feeTierId).toBe(tier.id);
    expect(rows.find((r) => r.id === e3.id)?.feeTierId).toBeNull();

    const cleared = await batchSetFeeTier([e1.id, e2.id], null);
    expect(cleared).toBe(2);
    const after = await prisma.tutoringEnrollment.findMany({ where: { id: { in: [e1.id, e2.id] } } });
    expect(after.every((r) => r.feeTierId === null)).toBe(true);
  });
});
