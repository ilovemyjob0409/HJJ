import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import {
  createProgram,
  listPrograms,
  updateProgram,
  deleteProgram,
  createWindow,
  updateWindow,
  deleteWindow,
  addWindowClosure,
  deleteWindowClosure,
} from './tutoringProgramService';
import { createEnrollment, listEnrollments, updateEnrollment, deleteEnrollment, getWindowInfo } from './tutoringProgramService';
import { createBooking } from './tutoringBookingService';

describe('program CRUD', () => {
  it('creates a program with defaults and lists it back with an empty windows array', async () => {
    const program = await createProgram({ name: '英文個別輔導' });
    expect(program.defaultMonthlyQuota).toBe(8);
    expect(program.defaultDurationMinutes).toBe(120);
    expect(program.active).toBe(true);

    const programs = await listPrograms();
    expect(programs).toHaveLength(1);
    expect(programs[0].windows).toEqual([]);
  });

  it('updates and soft-deactivates a program', async () => {
    const program = await createProgram({ name: '數學個別輔導', defaultMonthlyQuota: 6 });
    const updated = await updateProgram(program.id, { defaultMonthlyQuota: 10, active: false });
    expect(updated.defaultMonthlyQuota).toBe(10);
    expect(updated.active).toBe(false);
  });

  it('hard-deletes a program', async () => {
    const program = await createProgram({ name: '暫時課程' });
    await deleteProgram(program.id);
    expect(await prisma.tutoringProgram.findUnique({ where: { id: program.id } })).toBeNull();
  });

  it('rejects updating a nonexistent program with PROGRAM_NOT_FOUND', async () => {
    await expect(updateProgram('nonexistent-program-id', { active: false })).rejects.toThrow('PROGRAM_NOT_FOUND');
  });

  it('rejects deleting a nonexistent program with PROGRAM_NOT_FOUND', async () => {
    await expect(deleteProgram('nonexistent-program-id')).rejects.toThrow('PROGRAM_NOT_FOUND');
  });
});

describe('window CRUD', () => {
  it('creates a window under a program and lists it nested', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });

    await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const programs = await listPrograms();
    expect(programs[0].windows).toHaveLength(1);
    expect(programs[0].windows[0]).toMatchObject({ weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8 });
  });

  it('updates a window capacity and deletes it', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const updated = await updateWindow(window.id, { capacity: 10 });
    expect(updated.capacity).toBe(10);

    await deleteWindow(window.id);
    expect(await prisma.tutoringWindow.findUnique({ where: { id: window.id } })).toBeNull();
  });

  it('creates a window with an optional second teacher and can swap or clear it', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const teacher2 = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });

    const window = await createWindow({
      programId: program.id,
      weekday: 5,
      startTime: '16:00',
      endTime: '21:00',
      capacity: 8,
      teacherId: teacher.id,
      teacherId2: teacher2.id,
    });
    expect(window.teacherId2).toBe(teacher2.id);

    const programs = await listPrograms();
    expect(programs[0].windows[0].teacher2?.user.name).toBe('陳老師');

    const cleared = await updateWindow(window.id, { teacherId2: null });
    expect(cleared.teacherId2).toBeNull();
  });

  it('getWindowInfo returns teachers, capacity and upcoming active booking count', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const teacher2 = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: 'MPM' });
    const window = await createWindow({
      programId: program.id,
      weekday: 5,
      startTime: '16:00',
      endTime: '21:00',
      capacity: 8,
      teacherId: teacher.id,
      teacherId2: teacher2.id,
    });

    const student = await createStudent({ name: '小小', email: `info-${Date.now()}@example.com`, password: 'x' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    const future = new Date(Date.UTC(2099, 0, 2)); // Friday
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    const past = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringBooking.update({ where: { id: past.id }, data: { status: 'CANCELLED_LATE' } });

    const info = await getWindowInfo(window.id);
    expect(info).toMatchObject({
      programName: 'MPM',
      weekday: 5,
      capacity: 8,
      teacherNames: ['林老師', '陳老師'],
      upcomingBookedCount: 1, // 過去的與取消的都不算
    });

    await expect(getWindowInfo('nonexistent-window-id')).rejects.toThrow('WINDOW_NOT_FOUND');
  });

  it('rejects the same teacher as both main and second teacher', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });

    await expect(
      createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id, teacherId2: teacher.id })
    ).rejects.toThrow('DUPLICATE_TEACHER');

    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    await expect(updateWindow(window.id, { teacherId2: teacher.id })).rejects.toThrow('DUPLICATE_TEACHER');
  });

  it('adds and removes a window closure', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const closure = await addWindowClosure(window.id, new Date('2026-10-09'));
    expect(await prisma.tutoringWindowClosure.count({ where: { windowId: window.id } })).toBe(1);

    await deleteWindowClosure(closure.id);
    expect(await prisma.tutoringWindowClosure.count({ where: { windowId: window.id } })).toBe(0);
  });

  it('rejects updating a nonexistent window with WINDOW_NOT_FOUND', async () => {
    await expect(updateWindow('nonexistent-window-id', { capacity: 5 })).rejects.toThrow('WINDOW_NOT_FOUND');
  });

  it('rejects deleting a nonexistent window with WINDOW_NOT_FOUND', async () => {
    await expect(deleteWindow('nonexistent-window-id')).rejects.toThrow('WINDOW_NOT_FOUND');
  });

  it('rejects adding a duplicate window closure with CLOSURE_ALREADY_EXISTS', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    await addWindowClosure(window.id, new Date('2026-10-09'));
    await expect(addWindowClosure(window.id, new Date('2026-10-09'))).rejects.toThrow('CLOSURE_ALREADY_EXISTS');
  });

  it('rejects adding a closure for a nonexistent window with WINDOW_NOT_FOUND', async () => {
    await expect(addWindowClosure('nonexistent-window-id', new Date('2026-10-09'))).rejects.toThrow('WINDOW_NOT_FOUND');
  });

  it('rejects deleting a nonexistent window closure with CLOSURE_NOT_FOUND', async () => {
    await expect(deleteWindowClosure('nonexistent-closure-id')).rejects.toThrow('CLOSURE_NOT_FOUND');
  });
});

describe('enrollment CRUD', () => {
  it('creates an enrollment and lists it with the program default quota', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導', defaultMonthlyQuota: 8 });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });

    const list = await listEnrollments();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ studentName: '小明', programName: '英文個別輔導', monthlyQuota: 8, locked: 0, upcoming: 0 });

    const filtered = await listEnrollments(student.id);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(enrollment.id);
  });

  it('overrides monthlyQuota and deactivates, then deletes', async () => {
    const student = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const program = await createProgram({ name: '數學個別輔導' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });

    const updated = await updateEnrollment(enrollment.id, { monthlyQuota: 11, active: false });
    expect(updated.monthlyQuota).toBe(11);
    expect(updated.active).toBe(false);

    await deleteEnrollment(enrollment.id);
    expect(await prisma.tutoringEnrollment.findUnique({ where: { id: enrollment.id } })).toBeNull();
  });

  it('rejects updating a nonexistent enrollment with ENROLLMENT_NOT_FOUND', async () => {
    await expect(updateEnrollment('nonexistent-enrollment-id', { active: false })).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('rejects deleting a nonexistent enrollment with ENROLLMENT_NOT_FOUND', async () => {
    await expect(deleteEnrollment('nonexistent-enrollment-id')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('rejects creating a duplicate enrollment with ALREADY_ENROLLED', async () => {
    const student = await createStudent({ name: '小美', email: 'mei@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    await createEnrollment({ studentId: student.id, programId: program.id });

    await expect(createEnrollment({ studentId: student.id, programId: program.id })).rejects.toThrow('ALREADY_ENROLLED');
  });
});
