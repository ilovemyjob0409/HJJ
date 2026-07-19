import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher, listTeachers, updateTeacher } from './teacherService';

beforeEach(async () => {
  await prisma.substituteRequest.deleteMany();
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

describe('updateTeacher', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: 'chen@example.com',
      password: 'secret123',
      subjects: '英文',
      phone: '0911111111',
    });

    const updated = await updateTeacher(teacher.id, { phone: '0922222222' });

    expect(updated.phone).toBe('0922222222');
    expect(updated.subjects).toBe('英文');
    expect(updated.user.name).toBe('陳老師');
  });

  it('hashes a new password when provided, and leaves it unchanged when omitted', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: 'chen@example.com',
      password: 'secret123',
      subjects: '英文',
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'chen@example.com' } });

    await updateTeacher(teacher.id, { subjects: '數學' });
    const afterNoPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'chen@example.com' } });
    expect(afterNoPasswordChange.password).toBe(before.password);

    await updateTeacher(teacher.id, { password: 'newpassword456' });
    const afterPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'chen@example.com' } });
    expect(afterPasswordChange.password).not.toBe(before.password);
    expect(afterPasswordChange.password).not.toBe('newpassword456');
  });

  it('throws when the new email is already taken by another user', async () => {
    await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'secret123', subjects: '英文' });
    const other = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'secret123', subjects: '數學' });

    await expect(updateTeacher(other.id, { email: 'chen@example.com' })).rejects.toThrow();
  });
});
