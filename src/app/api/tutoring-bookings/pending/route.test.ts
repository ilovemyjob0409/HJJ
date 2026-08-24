import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

describe('GET /api/tutoring-bookings/pending', () => {
  it('403：非 ADMIN', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('ADMIN 拿到待審列（含 seq 與 monthUsage）', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const teacher = await createTeacher({ name: '林老師', email: `pending-route-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const student = await createStudent({ name: '小明', email: `pending-route-s-${Date.now()}@example.com`, password: 'x' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 0 });
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2027-01-01'), quotaReview: true });

    const res = await GET();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; seq: number; monthUsage: unknown[] }[];
    const mine = rows.find((r) => r.id === booking.id);
    expect(mine).toBeDefined();
    expect(mine!.seq).toBe(1);
    expect(mine!.monthUsage).toHaveLength(3);
  });
});
