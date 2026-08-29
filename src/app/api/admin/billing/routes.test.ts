import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { NextRequest } from 'next/server';
import { GET as listBatchesGET, POST as createBatchPOST } from './batches/route';
import { POST as addPaymentPOST } from './bills/[id]/payments/route';
import { GET as overviewGET } from './overview/route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';
import { createClassBatch, finalizeBatch, getBatchDetail } from '@/lib/services/billingBatchService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 's-user-1', role: 'STUDENT' } });

beforeEach(() => {
  sessionMock.mockReset();
});

async function setupClassFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `admin-billing-route-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `admin-billing-route-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  return { teacher, student, cls };
}

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/billing/x', { method: 'POST', body: JSON.stringify(body) }) as never;
}

describe('GET /api/admin/billing/batches', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await listBatchesGET();
    expect(res.status).toBe(403);
  });

  it('403 for a STUDENT', async () => {
    asStudent();
    const res = await listBatchesGET();
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN', async () => {
    asAdmin();
    const res = await listBatchesGET();
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('POST /api/admin/billing/batches', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await createBatchPOST(jsonReq({}) as never);
    expect(res.status).toBe(403);
  });

  it('403 for a STUDENT', async () => {
    asStudent();
    const res = await createBatchPOST(jsonReq({}) as never);
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, creates a class batch and returns { batchId, skipped }', async () => {
    const { cls } = await setupClassFixture();
    asAdmin();
    const res = await createBatchPOST(jsonReq({
      kind: 'CLASS', periodStart: '2026-09-01', periodEnd: '2026-09-30', classIds: [cls.id],
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('batchId');
    expect(body).toHaveProperty('skipped');
    expect(body.skipped).toEqual([]);
  });
});

describe('GET /api/admin/billing/overview', () => {
  const overviewReq = (qs: string) => new NextRequest(`http://localhost/api/admin/billing/overview${qs}`);

  it('403 when not logged in or for a STUDENT', async () => {
    asAnon();
    expect((await overviewGET(overviewReq('?start=2026-09-01&end=2026-09-30'))).status).toBe(403);
    asStudent();
    expect((await overviewGET(overviewReq('?start=2026-09-01&end=2026-09-30'))).status).toBe(403);
  });

  it('400 when start/end missing or malformed', async () => {
    asAdmin();
    expect((await overviewGET(overviewReq(''))).status).toBe(400);
    expect((await overviewGET(overviewReq('?start=2026-09-01'))).status).toBe(400);
    expect((await overviewGET(overviewReq('?start=abc&end=2026-09-30'))).status).toBe(400);
  });

  it('200 for ADMIN with summary and bills of the range', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    asAdmin();
    const res = await overviewGET(overviewReq('?start=2026-09-01&end=2026-09-30'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ totalDue: 2000, totalPaid: 0, totalOutstanding: 2000, count: 1 });
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0]).toMatchObject({ source: 'CLASS', studentName: '小明', targetName: '週六基礎班', state: 'UNPAID' });
  });
});

describe('POST /api/admin/billing/bills/[id]/payments', () => {
  async function finalizedBillId() {
    const { student, cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    const detail = await getBatchDetail(batchId);
    return { billId: detail.bills[0].id, studentId: student.id };
  }

  it('403 when not logged in', async () => {
    asAnon();
    const res = await addPaymentPOST(jsonReq({}) as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 for a STUDENT', async () => {
    asStudent();
    const res = await addPaymentPOST(jsonReq({}) as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, records a payment and notifies the student', async () => {
    const { billId } = await finalizedBillId();
    asAdmin();
    const res = await addPaymentPOST(jsonReq({
      amount: 1000, paidOn: '2026-09-10', method: 'CASH',
    }) as never, { params: { id: billId } });
    expect(res.status).toBe(200);
    const payments = await prisma.billPayment.findMany({ where: { billId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 1000, method: 'CASH', createdById: 'admin-1' });
  });
});
