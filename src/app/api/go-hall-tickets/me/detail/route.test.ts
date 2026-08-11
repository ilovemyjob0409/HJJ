import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { purchaseTickets } from '@/lib/services/goHallTicketService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/go-hall-tickets/me/detail', () => {
  it('403 when not a student', async () => {
    asAdmin();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("200 with the logged-in student's own ticket detail", async () => {
    const student = await createStudent({ name: '小明', email: 'gh-ticket-detail-route-ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 5 });
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(5);
    expect(body.history).toHaveLength(1);
  });
});
