import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher, listTeachers } from './teacherService';

beforeEach(async () => {
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('createTeacher', () => {
  it('creates a User with role TEACHER and a linked Teacher record', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: 'chen@example.com',
      password: 'secret123',
      subjects: '英文',
      phone: '0922222222',
    });
    expect(teacher.subjects).toBe('英文');

    const user = await prisma.user.findUnique({ where: { email: 'chen@example.com' } });
    expect(user?.role).toBe('TEACHER');
    expect(user?.password).not.toBe('secret123');
  });
});

describe('listTeachers', () => {
  it('returns all teachers with their user info', async () => {
    await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'secret123', subjects: '英文' });
    const teachers = await listTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0].user.name).toBe('陳老師');
  });
});
