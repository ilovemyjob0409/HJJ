import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent, listStudents } from './studentService';

beforeEach(async () => {
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
