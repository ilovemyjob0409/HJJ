import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createClass } from '@/lib/services/classService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'teacher-1', role: 'TEACHER' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/timetable', () => {
  it('401 when not logged in', async () => {
    asAnon();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 with classes and tutoringSlots for ADMIN', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'timetable-route-chen@example.com', password: 'x', subjects: '數學' });
    await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    asAdmin();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.classes).toHaveLength(1);
    expect(body.tutoringSlots).toEqual([]);
  });

  it('200 for TEACHER', async () => {
    asTeacher();
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('200 for STUDENT', async () => {
    asStudent();
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
