import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent, listStudents, updateStudent } from './studentService';

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

describe('createStudent', () => {
  it('creates a User with role STUDENT and a linked Student record', async () => {
    const student = await createStudent({
      name: '小華',
      email: 'hua@example.com',
      password: 'secret123',
      parentPhone: '0933333333',
    });
    expect(student.parentPhone).toBe('0933333333');
    const user = await prisma.user.findUnique({ where: { email: 'hua@example.com' } });
    expect(user?.role).toBe('STUDENT');
  });
});

describe('listStudents', () => {
  it('returns all students with user info', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const students = await listStudents();
    expect(students).toHaveLength(1);
    expect(students[0].user.name).toBe('小華');
  });
});

describe('updateStudent', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const student = await createStudent({
      name: '小華',
      email: 'hua@example.com',
      password: 'secret123',
      parentPhone: '0933333333',
    });

    const updated = await updateStudent(student.id, { parentPhone: '0944444444' });

    expect(updated.parentPhone).toBe('0944444444');
    expect(updated.user.name).toBe('小華');
  });

  it('hashes a new password when provided, and leaves it unchanged when omitted', async () => {
    const student = await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'hua@example.com' } });

    await updateStudent(student.id, { parentPhone: '0955555555' });
    const afterNoPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'hua@example.com' } });
    expect(afterNoPasswordChange.password).toBe(before.password);

    await updateStudent(student.id, { password: 'newpassword456' });
    const afterPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'hua@example.com' } });
    expect(afterPasswordChange.password).not.toBe(before.password);
  });

  it('throws when the new email is already taken by another user', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const other = await createStudent({ name: '小明', email: 'ming@example.com', password: 'secret123' });

    await expect(updateStudent(other.id, { email: 'hua@example.com' })).rejects.toThrow();
  });
});
