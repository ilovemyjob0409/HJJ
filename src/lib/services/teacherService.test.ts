import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher, listTeachers, updateTeacher, deleteTeacher } from './teacherService';
import { createClass } from './classService';
import { createSubstituteRequest } from './substituteRequestService';

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

  it('normalizes email casing and surrounding whitespace before storing', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: '  Chen@Example.com  ',
      password: 'secret123',
      subjects: '英文',
    });
    expect(teacher.user.email).toBe('chen@example.com');
  });

  it('rejects a second account whose email differs only by case or whitespace', async () => {
    await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'secret123', subjects: '英文' });

    await expect(
      createTeacher({ name: '林老師', email: ' Chen@Example.com', password: 'secret123', subjects: '數學' })
    ).rejects.toThrow();
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

  it('throws when the new email is taken, differing only by case or whitespace', async () => {
    await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'secret123', subjects: '英文' });
    const other = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'secret123', subjects: '數學' });

    await expect(updateTeacher(other.id, { email: ' CHEN@Example.com ' })).rejects.toThrow();
  });
});

describe('deleteTeacher', () => {
  it('deletes a teacher with no classes or substitute history, clearing the login account', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'teacher-delete-chen@example.com', password: 'secret123', subjects: '英文' });

    await deleteTeacher(teacher.id);

    expect(await prisma.teacher.findUnique({ where: { id: teacher.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'teacher-delete-chen@example.com' } })).toBeNull();
  });

  it('throws TEACHER_HAS_RECORDS and does not delete when the teacher still has a class assigned', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'teacher-delete-block-class-chen@example.com', password: 'secret123', subjects: '數學' });
    await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    await expect(deleteTeacher(teacher.id)).rejects.toThrow('TEACHER_HAS_RECORDS');
    expect(await prisma.teacher.findUnique({ where: { id: teacher.id } })).not.toBeNull();
  });

  it('throws TEACHER_HAS_RECORDS and does not delete when the teacher has substitute-request history as the original teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'teacher-delete-block-sub-chen@example.com', password: 'secret123', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    // Reassign the class away so only the substitute-request history blocks deletion.
    const otherTeacher = await createTeacher({ name: '林老師', email: 'teacher-delete-block-sub-lin@example.com', password: 'secret123', subjects: '數學' });
    await prisma.class.update({ where: { id: cls.id }, data: { teacherId: otherTeacher.id } });
    await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '請假' });

    await expect(deleteTeacher(teacher.id)).rejects.toThrow('TEACHER_HAS_RECORDS');
    expect(await prisma.teacher.findUnique({ where: { id: teacher.id } })).not.toBeNull();
  });
});
