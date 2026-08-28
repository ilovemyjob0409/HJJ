import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { createProgram } from './tutoringProgramService';
import {
  listFeeTiers, createFeeTier, updateFeeTier, deleteFeeTier, seedDefaultFeeTiers, setEnrollmentFeeTier,
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
});
