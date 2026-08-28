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

beforeEach(async () => {
  sessionMock.mockReset();
  // Create marker user for attendance marking
  await prisma.user.create({
    data: {
      id: 'marker-1',
      email: 'marker@example.com',
      password: 'x',
      name: 'Marker',
      role: 'TEACHER',
    },
  });
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 't-1', role: 'TEACHER' } });

async function setup() {
  const teacher = await createTeacher({ name: '米奇老師', email: `enr-att-route-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
  const student = await createStudent({ name: '小明', email: `enr-att-route-ming-${Date.now()}@example.com`, password: 'x' });
  const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
  await saveTutoringAttendance(window.id, 'marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);
  return { student, enrollment };
}

async function studentUserId(studentId: string): Promise<string> {
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
  return userId;
}

describe('GET /api/tutoring-enrollments/[id]/attendance', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 for a TEACHER', async () => {
    asTeacher();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('404 for ADMIN when the enrollment does not exist', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'nonexistent-enrollment-id' } });
    expect(res.status).toBe(404);
  });

  it('200 for ADMIN with names and records', async () => {
    const { enrollment } = await setup();
    asAdmin();
    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.studentName).toBe('小明');
    expect(body.programName).toBe('英文個別輔導');
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ attendanceStatus: 'PRESENT', bookingStatus: 'BOOKED', checkInTime: '17:00', checkOutTime: '19:00', isMakeup: false });
    expect(body.records[0].date.slice(0, 10)).toBe('2020-01-03');
  });

  it('200 for the STUDENT who owns the enrollment', async () => {
    const { student, enrollment } = await setup();
    sessionMock.mockResolvedValue({ user: { id: await studentUserId(student.id), role: 'STUDENT' } });
    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toHaveLength(1);
  });

  it("404 for a STUDENT reading another student's enrollment", async () => {
    const { enrollment } = await setup();
    const other = await createStudent({ name: '小華', email: `enr-att-route-hua-${Date.now()}@example.com`, password: 'x' });
    sessionMock.mockResolvedValue({ user: { id: await studentUserId(other.id), role: 'STUDENT' } });
    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(404);
  });
});
