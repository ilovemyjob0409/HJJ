import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking } from '@/lib/services/tutoringBookingService';
import { saveTutoringAttendance } from '@/lib/services/attendanceService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });

async function setup() {
  const teacher = await createTeacher({ name: '米奇老師', email: `tw-overview-route-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const teacher2 = await createTeacher({ name: '甜甜圈老師', email: `tw-overview-route-donut-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({
    programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id, teacherId2: teacher2.id,
  });
  const student = await createStudent({ name: '小明', email: `tw-overview-route-ming-${Date.now()}@example.com`, password: 'x' });
  await createEnrollment({ studentId: student.id, programId: program.id });
  return { teacher, teacher2, program, window, student };
}

describe('GET /api/tutoring-windows/[id]/attendance-overview', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 for a STUDENT', async () => {
    asStudent();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('404 when the window does not exist (admin)', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'nonexistent-window-id' } });
    expect(res.status).toBe(404);
  });

  it('403 for a TEACHER who is neither the main nor the second teacher of this window', async () => {
    const { window } = await setup();
    const other = await createTeacher({ name: '林老師', email: `tw-overview-route-lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: other.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(403);
  });

  it("200 with window info and students for the window's main TEACHER", async () => {
    const { teacher, program, window, student } = await setup();
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const enrollment = await prisma.tutoringEnrollment.findFirstOrThrow({ where: { studentId: student.id, programId: program.id } });
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance(userId, [{ bookingId: booking.id, status: 'PRESENT' }]);

    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window).toMatchObject({
      id: window.id, weekday: 5, startTime: '17:00', endTime: '19:00', programName: '英文個別輔導', teacherName: '米奇老師', teacherName2: '甜甜圈老師',
    });
    expect(typeof body.todayKey).toBe('string');
    expect(body.students).toHaveLength(1);
    expect(body.students[0].studentName).toBe('小明');
    expect(body.students[0].records).toHaveLength(1);
    expect(typeof body.students[0].records[0].date).toBe('string');
    expect(body.students[0].records[0].date.slice(0, 10)).toBe('2020-01-03');
    expect(body.students[0].records[0].attendanceStatus).toBe('PRESENT');
  });

  it("200 for the window's second TEACHER", async () => {
    const { teacher2, window } = await setup();
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher2.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(200);
  });

  it('200 for ADMIN on any window', async () => {
    const { window } = await setup();
    asAdmin();
    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(200);
  });
});
