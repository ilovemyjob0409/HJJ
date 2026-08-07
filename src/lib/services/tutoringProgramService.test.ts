import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
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

  it('adds and removes a window closure', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const closure = await addWindowClosure(window.id, new Date('2026-10-09'));
    expect(await prisma.tutoringWindowClosure.count({ where: { windowId: window.id } })).toBe(1);

    await deleteWindowClosure(closure.id);
    expect(await prisma.tutoringWindowClosure.count({ where: { windowId: window.id } })).toBe(0);
  });
});
