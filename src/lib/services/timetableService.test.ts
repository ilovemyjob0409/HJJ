import { describe, it, expect } from 'vitest';
import { createTeacher } from './teacherService';
import { createClass } from './classService';
import { createProgram, createWindow, updateProgram, updateWindow } from './tutoringProgramService';
import { listClassesForTimetable, listTutoringSlotsForTimetable } from './timetableService';

describe('listClassesForTimetable', () => {
  it('returns class schedule fields without enrollments', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'timetable-chen@example.com', password: 'x', subjects: '數學' });
    await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const classes = await listClassesForTimetable();
    expect(classes).toHaveLength(1);
    expect(classes[0]).toMatchObject({
      name: '數學A班',
      subject: '數學',
      level: '國一',
      weekday: 1,
      startTime: '19:00',
      endTime: '21:00',
      teacher: { user: { name: '陳老師' } },
    });
    expect(classes[0]).not.toHaveProperty('enrollments');
  });
});

describe('listTutoringSlotsForTimetable', () => {
  it('flattens active windows under active programs with the program name attached', async () => {
    const teacher = await createTeacher({ name: '王老師', email: 'timetable-wang1@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: 'MPM' });
    const window = await createWindow({ programId: program.id, weekday: 3, startTime: '16:00', endTime: '18:00', capacity: 8, teacherId: teacher.id });

    const slots = await listTutoringSlotsForTimetable();
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      id: window.id,
      programName: 'MPM',
      weekday: 3,
      startTime: '16:00',
      endTime: '18:00',
      teacher: { user: { name: '王老師' } },
    });
  });

  it('excludes windows under an inactive program', async () => {
    const teacher = await createTeacher({ name: '王老師', email: 'timetable-wang2@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '普拉斯' });
    await createWindow({ programId: program.id, weekday: 2, startTime: '16:00', endTime: '18:00', capacity: 8, teacherId: teacher.id });
    await updateProgram(program.id, { active: false });

    expect(await listTutoringSlotsForTimetable()).toEqual([]);
  });

  it('excludes an inactive window under an active program', async () => {
    const teacher = await createTeacher({ name: '王老師', email: 'timetable-wang3@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: 'MPM' });
    const window = await createWindow({ programId: program.id, weekday: 2, startTime: '16:00', endTime: '18:00', capacity: 8, teacherId: teacher.id });
    await updateWindow(window.id, { active: false });

    expect(await listTutoringSlotsForTimetable()).toEqual([]);
  });
});
