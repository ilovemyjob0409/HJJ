import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createStudent, listStudents, updateStudent, deleteStudent } from './studentService';
import { createTeacher } from './teacherService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { p2002TargetsField } from '@/lib/prismaErrors';
import { setSiblings } from './familyService';

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

  it('normalizes email casing and surrounding whitespace before storing', async () => {
    const student = await createStudent({
      name: '小華',
      email: '  Hua@Example.com  ',
      password: 'secret123',
    });
    expect(student.user.email).toBe('hua@example.com');
  });

  it('rejects a second account whose email differs only by case or whitespace', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });

    await expect(
      createStudent({ name: '小明', email: ' Hua@Example.com', password: 'secret123' })
    ).rejects.toThrow();
  });

  it('stores and returns the student number', async () => {
    const student = await createStudent({ name: '小華', email: 'sn-hua@example.com', password: 'secret123', studentNumber: 'S100' });
    expect(student.studentNumber).toBe('S100');
  });

  it('rejects a second student with the same student number', async () => {
    await createStudent({ name: '小華', email: 'sn-hua2@example.com', password: 'secret123', studentNumber: 'S101' });

    await expect(
      createStudent({ name: '小明', email: 'sn-ming2@example.com', password: 'secret123', studentNumber: 'S101' })
    ).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { email: 'sn-ming2@example.com' } })).toBeNull();
  });

  it('the rejected duplicate is recognized as a studentNumber conflict, not an email conflict', async () => {
    await createStudent({ name: '小華', email: 'sn-target-hua@example.com', password: 'secret123', studentNumber: 'S102' });

    try {
      await createStudent({ name: '小明', email: 'sn-target-ming@example.com', password: 'secret123', studentNumber: 'S102' });
      throw new Error('expected createStudent to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const prismaErr = err as Prisma.PrismaClientKnownRequestError;
      expect(prismaErr.code).toBe('P2002');
      expect(p2002TargetsField(prismaErr, 'studentNumber')).toBe(true);
      expect(p2002TargetsField(prismaErr, 'email')).toBe(false);
    }
  });

  it('normalizes a blank student number to null so a second blank one does not collide', async () => {
    await createStudent({ name: '小華', email: 'sn-blank1@example.com', password: 'secret123', studentNumber: '' });
    const second = await createStudent({ name: '小明', email: 'sn-blank2@example.com', password: 'secret123', studentNumber: '' });
    expect(second.studentNumber).toBeNull();
  });
});

describe('listStudents', () => {
  it('returns all students with user info', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const students = await listStudents();
    expect(students).toHaveLength(1);
    expect(students[0].user.name).toBe('小華');
  });

  it('includes per-enrollment session quota, with used sessions excluding leave', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'student-list-quota-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'student-list-quota-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });
    const marker = await prisma.user.create({ data: { id: 'quota-marker-1', name: '行政', email: 'quota-marker@example.com', password: 'x', role: 'ADMIN' } });
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04'), status: 'PRESENT', markedById: marker.id },
    });
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-11'), status: 'ON_LEAVE', markedById: marker.id },
    });

    const students = await listStudents();

    const found = students.find((s) => s.id === student.id);
    expect(found?.enrollments).toHaveLength(1);
    expect(found?.enrollments[0].classId).toBe(cls.id);
    expect(found?.enrollments[0].totalSessions).toBe(12);
    expect(found?.enrollments[0].usedSessions).toBe(1);
    expect(found?.enrollments[0].remaining).toBe(11);
  });
});

describe('listStudents familyGroupId', () => {
  it('includes familyGroupId, null by default', async () => {
    const a = await createStudent({ name: 'A', email: 'fam-a@x.com', password: 'pw' });
    const list = await listStudents();
    const row = list.find((s) => s.id === a.id);
    expect(row?.familyGroupId).toBeNull();
  });

  it('reflects the assigned family group after setSiblings', async () => {
    const a = await createStudent({ name: 'A', email: 'fam-a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'fam-b2@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    const list = await listStudents();
    const rowA = list.find((s) => s.id === a.id);
    const rowB = list.find((s) => s.id === b.id);
    expect(rowA?.familyGroupId).not.toBeNull();
    expect(rowA?.familyGroupId).toBe(rowB?.familyGroupId);
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

  it('throws when the new email is taken, differing only by case or whitespace', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const other = await createStudent({ name: '小明', email: 'ming@example.com', password: 'secret123' });

    await expect(updateStudent(other.id, { email: ' HUA@Example.com ' })).rejects.toThrow();
  });

  it('updates the student number', async () => {
    const student = await createStudent({ name: '小華', email: 'sn-update-hua@example.com', password: 'secret123' });

    const updated = await updateStudent(student.id, { studentNumber: 'S200' });

    expect(updated.studentNumber).toBe('S200');
  });

  it('leaves an existing student number untouched when the update omits the field', async () => {
    const student = await createStudent({ name: '小華', email: 'sn-omit-hua@example.com', password: 'secret123', studentNumber: 'S201' });

    const updated = await updateStudent(student.id, { parentPhone: '0966666666' });

    expect(updated.studentNumber).toBe('S201');
  });

  it('normalizes a blank student number to null on update', async () => {
    const student = await createStudent({ name: '小華', email: 'sn-update-blank@example.com', password: 'secret123', studentNumber: 'S202' });

    const updated = await updateStudent(student.id, { studentNumber: '' });

    expect(updated.studentNumber).toBeNull();
  });
});

describe('deleteStudent', () => {
  it('deletes a student with no history, clearing enrollments and the login account', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'student-delete-chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const student = await createStudent({ name: '小華', email: 'student-delete-hua@example.com', password: 'secret123' });
    await enrollStudent(cls.id, student.id);

    await deleteStudent(student.id);

    expect(await prisma.student.findUnique({ where: { id: student.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'student-delete-hua@example.com' } })).toBeNull();
    expect(await prisma.classEnrollment.findMany({ where: { studentId: student.id } })).toHaveLength(0);
  });

  it('throws STUDENT_HAS_RECORDS and does not delete when the student has a leave request', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'student-delete-block-chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const student = await createStudent({ name: '小華', email: 'student-delete-block-hua@example.com', password: 'secret123' });
    await enrollStudent(cls.id, student.id);
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });

    await expect(deleteStudent(student.id)).rejects.toThrow('STUDENT_HAS_RECORDS');
    expect(await prisma.student.findUnique({ where: { id: student.id } })).not.toBeNull();
  });
});
