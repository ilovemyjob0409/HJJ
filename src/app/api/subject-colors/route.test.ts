import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from './route';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'teacher-1', role: 'TEACHER' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/subject-colors', () => {
  it('401 when not logged in', async () => {
    asAnon();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 for ADMIN', async () => {
    asAdmin();
    const res = await GET();
    expect(res.status).toBe(200);
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

describe('POST /api/subject-colors', () => {
  it('403 for non-ADMIN', async () => {
    asStudent();
    const req = new NextRequest('http://x/api/subject-colors', {
      method: 'POST',
      body: JSON.stringify({ subject: '數學', color: '#123456' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, saves the color', async () => {
    asAdmin();
    const req = new NextRequest('http://x/api/subject-colors', {
      method: 'POST',
      body: JSON.stringify({ subject: '數學', color: '#123456' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ subject: '數學', color: '#123456' });
  });
});
