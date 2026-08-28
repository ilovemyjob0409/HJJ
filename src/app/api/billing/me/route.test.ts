import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';
import { createClassBatch, finalizeBatch } from '@/lib/services/billingBatchService';
import { updateBillingSetting } from '@/lib/services/billingSettingService';

beforeEach(() => sessionMock.mockReset());

const asStudent = (userId: string) => sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });
const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function studentUserId(studentId: string): Promise<string> {
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
  return userId;
}

async function billedStudent(name: string, email: string) {
  const teacher = await createTeacher({ name: '陳老師', email: `me-${Date.now()}-${Math.random()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name, email, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  return student;
}

describe('GET /api/billing/me', () => {
  it('403 when not logged in or not a student', async () => {
    asAnon();
    expect((await GET()).status).toBe(403);
    asAdmin();
    expect((await GET()).status).toBe(403);
  });

  it('returns only the caller\'s finalized bills, not another student\'s, and includes paymentInfo', async () => {
    await updateBillingSetting({ paymentInfo: '銀行帳戶 123' });
    const me = await billedStudent('小明', `me-ming-${Date.now()}@example.com`);
    const other = await billedStudent('小華', `me-hua-${Date.now()}@example.com`);
    void other;

    asStudent(await studentUserId(me.id));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentInfo).toBe('銀行帳戶 123');
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0]).toMatchObject({ targetName: '週六班', amountDue: 2000, paid: 0, outstanding: 2000, state: 'UNPAID' });
  });

  it('excludes draft bills', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `me-draft-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小美', email: `me-draft-s-${Date.now()}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    await enrollStudent(cls.id, student.id);
    await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] }); // 未定案

    asStudent(await studentUserId(student.id));
    const body = await (await GET()).json();
    expect(body.bills).toHaveLength(0);
  });
});
