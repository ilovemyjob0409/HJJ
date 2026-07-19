import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, listClasses, listClassesBySubjectAndLevel, enrollStudent, updateClass } from './classService';

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

describe('createClass / listClasses', () => {
  it('creates and lists a class with its teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-chen@example.com', password: 'x', subjects: '數學' });
    expect(teacher).toBeDefined();

    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    expect(cls.name).toBe('數學A班');

    // Verify teacher exists
    const teacherCheck = await prisma.teacher.findUnique({ where: { id: teacher.id } });
    expect(teacherCheck).toBeDefined();

    // Verify class exists in DB with raw query
    const rawClasses = await prisma.class.findMany();
    expect(rawClasses).toHaveLength(1);

    const classes = await listClasses();
    expect(classes).toHaveLength(1);
    expect(classes[0].teacher.user.name).toBe('陳老師');
  });
});

describe('listClassesBySubjectAndLevel', () => {
  it('returns only classes matching subject and level, excluding the given class', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-filter-chen@example.com', password: 'x', subjects: '數學' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '英文班', subject: '英文', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    const result = await listClassesBySubjectAndLevel('數學', '國一', classA.id);
    expect(result.map((c) => c.id)).toEqual([classB.id]);
  });

  it('excludes classes with the same subject but a different level', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-filter-level-chen@example.com', password: 'x', subjects: '數學' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '數學高一班', subject: '數學', level: '高一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    const result = await listClassesBySubjectAndLevel('數學', '國一', classA.id);
    expect(result.map((c) => c.id)).toEqual([classB.id]);
  });
});

describe('enrollStudent', () => {
  it('links a student to a class', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const enrollment = await enrollStudent(cls.id, student.id);
    expect(enrollment.studentId).toBe(student.id);
    expect(enrollment.classId).toBe(cls.id);
  });
});

describe('updateClass', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-update-chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const updated = await updateClass(cls.id, { startTime: '20:00', endTime: '22:00' });

    expect(updated.startTime).toBe('20:00');
    expect(updated.endTime).toBe('22:00');
    expect(updated.name).toBe('數學A班');
    expect(updated.weekday).toBe(1);
  });
});
