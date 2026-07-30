import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from './resetDb';

describe('resetDb', () => {
  it('empties tables linked by foreign keys without throwing FK violations', async () => {
    const user = await prisma.user.create({
      data: { email: 'reset-test@example.com', password: 'x', name: '測試', role: 'TEACHER' },
    });
    const teacher = await prisma.teacher.create({
      data: { userId: user.id, subjects: '數學' },
    });
    await prisma.class.create({
      data: { name: '測試班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' },
    });

    await resetDb();

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.teacher.count()).toBe(0);
    expect(await prisma.class.count()).toBe(0);
  });

  it('is safe to call when the tables are already empty', async () => {
    await resetDb();
    await expect(resetDb()).resolves.toBeUndefined();
  });
});
