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
import { createEnrollment, listEnrollments, updateEnrollment, deleteEnrollment, getWindowInfo, listWindowsForTeacher } from './tutoringProgramService';
import { createBooking, getMonthlyQuotaStatus, taipeiDateKey } from './tutoringBookingService';
import { saveTutoringAttendance } from './attendanceService';

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

  it('throws PROGRAM_HAS_RECORDS and does not delete when the program still has a window', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'program-delete-block-window-lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    await expect(deleteProgram(program.id)).rejects.toThrow('PROGRAM_HAS_RECORDS');
    expect(await prisma.tutoringProgram.findUnique({ where: { id: program.id } })).not.toBeNull();
  });

  it('throws PROGRAM_HAS_RECORDS and does not delete when the program still has an enrollment', async () => {
    const student = await createStudent({ name: '小明', email: 'program-delete-block-enrollment-ming@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    await createEnrollment({ studentId: student.id, programId: program.id });

    await expect(deleteProgram(program.id)).rejects.toThrow('PROGRAM_HAS_RECORDS');
    expect(await prisma.tutoringProgram.findUnique({ where: { id: program.id } })).not.toBeNull();
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

  it('throws WINDOW_HAS_BOOKINGS and does not delete when the window still has a booking', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'window-delete-block-booking-lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const student = await createStudent({ name: '小明', email: 'window-delete-block-booking-ming@example.com', password: 'x' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) }); // Friday

    await expect(deleteWindow(window.id)).rejects.toThrow('WINDOW_HAS_BOOKINGS');
    expect(await prisma.tutoringWindow.findUnique({ where: { id: window.id } })).not.toBeNull();
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

  it('rejects a closure whose date does not fall on the window weekday with INVALID_WEEKDAY', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    // 2026-10-08 是週四，時段是週五
    await expect(addWindowClosure(window.id, new Date('2026-10-08'))).rejects.toThrow('INVALID_WEEKDAY');
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

  it('rejects updating monthlyQuota on a nonexistent enrollment with ENROLLMENT_NOT_FOUND', async () => {
    await expect(updateEnrollment('nonexistent-enrollment-id', { monthlyQuota: 5 })).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('rejects deleting a nonexistent enrollment with ENROLLMENT_NOT_FOUND', async () => {
    await expect(deleteEnrollment('nonexistent-enrollment-id')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('throws ENROLLMENT_HAS_BOOKINGS and does not delete when the enrollment still has a booking', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'enrollment-delete-block-booking-lin@example.com', password: 'x', subjects: '英文' });
    const student = await createStudent({ name: '小美', email: 'enrollment-delete-block-booking-mei@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) }); // Friday

    await expect(deleteEnrollment(enrollment.id)).rejects.toThrow('ENROLLMENT_HAS_BOOKINGS');
    expect(await prisma.tutoringEnrollment.findUnique({ where: { id: enrollment.id } })).not.toBeNull();
  });

  it('rejects creating a duplicate enrollment with ALREADY_ENROLLED', async () => {
    const student = await createStudent({ name: '小美', email: 'mei@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    await createEnrollment({ studentId: student.id, programId: program.id });

    await expect(createEnrollment({ studentId: student.id, programId: program.id })).rejects.toThrow('ALREADY_ENROLLED');
  });
});

describe('updateEnrollment quota change history', () => {
  it('records a baseline row for the old value plus a row for the new value on the first real quota change', async () => {
    const student = await createStudent({ name: '小美', email: 'quota-history-first@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導', defaultMonthlyQuota: 8 });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id }); // monthlyQuota null → 用課程預設 8

    await updateEnrollment(enrollment.id, { monthlyQuota: 11 });

    const changes = await prisma.tutoringQuotaChange.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(changes.map((c) => c.monthlyQuota)).toEqual([8, 11]);
    expect(changes[0].effectiveFrom).toEqual(new Date(0)); // 舊值基準列蓋住所有既有歷史月份
  });

  it('does not write history when the update leaves the effective quota unchanged', async () => {
    const student = await createStudent({ name: '小美', email: 'quota-history-noop@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導', defaultMonthlyQuota: 8 });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 11 });

    await updateEnrollment(enrollment.id, { monthlyQuota: 11 }); // 設成同一個值
    await updateEnrollment(enrollment.id, { active: false }); // 不涉及 monthlyQuota

    const count = await prisma.tutoringQuotaChange.count({ where: { enrollmentId: enrollment.id } });
    expect(count).toBe(0);
  });

  it('only adds one row (no repeated baseline) for a second real quota change', async () => {
    const student = await createStudent({ name: '小美', email: 'quota-history-second@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導', defaultMonthlyQuota: 8 });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });

    await updateEnrollment(enrollment.id, { monthlyQuota: 11 });
    await updateEnrollment(enrollment.id, { monthlyQuota: 13 });

    const changes = await prisma.tutoringQuotaChange.findMany({ where: { enrollmentId: enrollment.id } });
    expect(changes.map((c) => c.monthlyQuota).sort((a, b) => a - b)).toEqual([8, 11, 13]);
  });

  it('treats clearing the override back to null as a real change when it differs from the program default', async () => {
    const student = await createStudent({ name: '小美', email: 'quota-history-clear@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導', defaultMonthlyQuota: 8 });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 11 });

    await updateEnrollment(enrollment.id, { monthlyQuota: null });

    const changes = await prisma.tutoringQuotaChange.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(changes.map((c) => c.monthlyQuota)).toEqual([11, 8]); // 基準列記舊值 11，新列記回退後的課程預設 8
  });
});

describe('listWindowsForTeacher', () => {
  it('returns only the windows where the teacher is the main or second teacher, with program name', async () => {
    const teacher = await createTeacher({ name: '米奇老師', email: `list-windows-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const other = await createTeacher({ name: '林老師', email: `list-windows-lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const mainWindow = await createWindow({ programId: program.id, weekday: 1, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
    const secondWindow = await createWindow({
      programId: program.id, weekday: 2, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: other.id, teacherId2: teacher.id,
    });
    await createWindow({ programId: program.id, weekday: 3, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: other.id });

    const list = await listWindowsForTeacher(teacher.id);
    expect(list.map((w) => w.id).sort()).toEqual([mainWindow.id, secondWindow.id].sort());
    expect(list.find((w) => w.id === mainWindow.id)).toMatchObject({ programName: '英文個別輔導', weekday: 1, startTime: '17:00', endTime: '19:00' });

    const inactiveWindow = await createWindow({ programId: program.id, weekday: 4, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
    await updateWindow(inactiveWindow.id, { active: false });
    const listAfterDeactivation = await listWindowsForTeacher(teacher.id);
    expect(listAfterDeactivation).toHaveLength(2);
    expect(listAfterDeactivation.map((w) => w.id)).not.toContain(inactiveWindow.id);
  });

  it('returns an empty array for a teacher with no windows', async () => {
    const teacher = await createTeacher({ name: '甜甜圈老師', email: `list-windows-donut-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const list = await listWindowsForTeacher(teacher.id);
    expect(list).toEqual([]);
  });
});

describe('listEnrollments 批次額度＝逐筆 getMonthlyQuotaStatus（對照）', () => {
  it('locked／upcoming／pendingOverQuota 三桶都與逐筆計算一致', async () => {
    // 「台北今天」動態 fixture：今天永遠在當月，三桶都能穩定造出、不會 rot
    const [ty, tm, td] = taipeiDateKey(new Date()).split('-').map(Number);
    const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
    const monthKey = taipeiDateKey(new Date()).slice(0, 7);

    const teacher = await createTeacher({ name: '林老師', email: `batch-quota-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: todayUtc.getUTCDay(), startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const marker = await prisma.user.create({
      data: { email: `batch-quota-marker-${Date.now()}@example.com`, password: 'x', name: 'Marker', role: 'TEACHER' },
    });

    // A：今天到場 → locked=1
    const sa = await createStudent({ name: '甲生', email: `batch-quota-a-${Date.now()}@example.com`, password: 'x' });
    const ea = await createEnrollment({ studentId: sa.id, programId: program.id });
    const ba = await createBooking({ enrollmentId: ea.id, windowId: window.id, date: todayUtc });
    await saveTutoringAttendance(window.id, marker.id, [{ bookingId: ba.id, status: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' }]);

    // B：quota 0＋quotaReview → 今天一筆 PENDING_ADMIN → pendingOverQuota=1
    const sb = await createStudent({ name: '乙生', email: `batch-quota-b-${Date.now()}@example.com`, password: 'x' });
    const eb = await createEnrollment({ studentId: sb.id, programId: program.id, monthlyQuota: 0 });
    await createBooking({ enrollmentId: eb.id, windowId: window.id, date: todayUtc, quotaReview: true });

    // C：今天一筆一般預約 → upcoming=1
    const sc = await createStudent({ name: '丙生', email: `batch-quota-c-${Date.now()}@example.com`, password: 'x' });
    const ec = await createEnrollment({ studentId: sc.id, programId: program.id });
    await createBooking({ enrollmentId: ec.id, windowId: window.id, date: todayUtc });

    const rows = (await listEnrollments()).filter((r) => [ea.id, eb.id, ec.id].includes(r.id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const ref = await getMonthlyQuotaStatus(row.id, monthKey);
      expect({ locked: row.locked, upcoming: row.upcoming, pendingOverQuota: row.pendingOverQuota, quota: row.monthlyQuota })
        .toEqual({ locked: ref.locked, upcoming: ref.upcoming, pendingOverQuota: ref.pendingOverQuota, quota: ref.quota });
    }
    // 三桶各自被造出來（不是全零的空對照）
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ea.id)!.locked).toBe(1);
    expect(byId.get(eb.id)!.pendingOverQuota).toBe(1);
    expect(byId.get(ec.id)!.upcoming).toBe(1);
  });
});
