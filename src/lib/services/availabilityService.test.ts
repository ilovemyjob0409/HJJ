import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { setTeacherAvailability, listTeacherAvailability } from './availabilityService';

beforeEach(async () => {
  await prisma.leaveRequest.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('setTeacherAvailability', () => {
  it('replaces all windows for a teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    await setTeacherAvailability(teacher.id, [{ weekday: 1, startTime: '16:00', endTime: '18:00' }]);
    await setTeacherAvailability(teacher.id, [
      { weekday: 3, startTime: '16:00', endTime: '18:00' },
      { weekday: 5, startTime: '10:00', endTime: '12:00' },
    ]);

    const windows = await listTeacherAvailability(teacher.id);
    expect(windows).toHaveLength(2);
    expect(windows.map((w) => w.weekday).sort()).toEqual([3, 5]);
  });
});
