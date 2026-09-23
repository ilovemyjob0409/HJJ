import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { NextRequest } from 'next/server';
import { GET as listBatchesGET, POST as createBatchPOST } from './batches/route';
import { POST as addPaymentPOST } from './bills/[id]/payments/route';
import { PATCH as updateBillPATCH, DELETE as deleteBillDELETE } from './bills/[id]/route';
import { POST as standalonePOST } from './standalone/route';
import { GET as overviewGET } from './overview/route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';
import { createClassBatch, finalizeBatch, getBatchDetail } from '@/lib/services/billingBatchService';
import { createGoHallBill } from '@/lib/services/goHallBillService';
import { getTicketBalance } from '@/lib/services/goHallTicketService';

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

  it('400 when only one of start/end is given or a date is malformed', async () => {
    asAdmin();
    expect((await overviewGET(overviewReq('?start=2026-09-01'))).status).toBe(400);
    expect((await overviewGET(overviewReq('?end=2026-09-30'))).status).toBe(400);
    expect((await overviewGET(overviewReq('?start=abc&end=2026-09-30'))).status).toBe(400);
  });

  it('200 with all finalized bills when no range is given (default view)', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    asAdmin();
    const res = await overviewGET(overviewReq(''));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.count).toBe(1);
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

describe('PATCH /api/admin/billing/bills/[id]（已定案帳單編輯）', () => {
  function patchReq(body: unknown): Request {
    return new Request('http://localhost/api/admin/billing/bills/x', { method: 'PATCH', body: JSON.stringify(body) }) as never;
  }

  it('已定案未繳帳單可改堂數、優惠與金額（含堂數帳連動）', async () => {
    const { student, cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    const bill = (await getBatchDetail(batchId)).bills[0];
    asAdmin();

    const res = await updateBillPATCH(
      patchReq({ billedSessions: 5, amountDue: 2300, discounts: [{ name: '早鳥優惠', amount: 200 }] }) as never,
      { params: { id: bill.id } }
    );

    expect(res.status).toBe(200);
    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(updated.billedSessions).toBe(5);
    expect(updated.amountDue).toBe(2300);
    expect((updated.detail as { discounts: unknown[] }).discounts).toHaveLength(1);
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(5);
  });

  it('草稿帳單 PATCH 走原本的草稿編輯路徑', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    const bill = (await getBatchDetail(batchId)).bills[0];
    asAdmin();

    const res = await updateBillPATCH(patchReq({ billedSessions: 3 }) as never, { params: { id: bill.id } });

    expect(res.status).toBe(200);
    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(updated).toMatchObject({ billedSessions: 3, status: 'DRAFT' });
  });

  it('403 when not logged in', async () => {
    asAnon();
    const res = await updateBillPATCH(patchReq({}) as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/billing/standalone GO_HALL', () => {
  it('試算＋建立堂票帳單；overview source=GO_HALL', async () => {
    asAdmin();
    const student = await createStudent({ name: '小弈', email: `gh-route-${Date.now()}@example.com`, password: 'x' });
    const preview = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: true, studentId: student.id, item: 'TICKETS', sessions: 4, unitPrice: 250 }) as never);
    expect(preview.status).toBe(200);
    expect((await preview.json()).amountDue).toBe(1000);

    const created = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: false, studentId: student.id, item: 'TICKETS', sessions: 4, unitPrice: 250, amountDue: 1000 }) as never);
    expect(created.status).toBe(200);
    const res = await overviewGET(new NextRequest('http://localhost/api/admin/billing/overview'));
    const row = (await res.json()).bills.find((b: { studentName: string }) => b.studentName === '小弈');
    expect(row).toMatchObject({ source: 'GO_HALL', goHallItem: 'TICKETS', goHallTickets: 4, targetName: '弈廳堂票 4 堂' });
  });

  it('缺欄位 400 MISSING_FIELDS；堂數 0 回 400 INVALID_INPUT', async () => {
    asAdmin();
    const r1 = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: true, item: 'TICKETS' }) as never);
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe('MISSING_FIELDS');
    const r2 = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: true, studentId: 'x', item: 'TICKETS', sessions: 0, unitPrice: 1 }) as never);
    expect((await r2.json()).error).toBe('INVALID_INPUT');
  });

  it('季票 startDate 格式錯誤回 400 INVALID_INPUT', async () => {
    asAdmin();
    const student = await createStudent({ name: '小弈2', email: `gh-route-badstart-${Date.now()}@example.com`, password: 'x' });
    const r = await standalonePOST(jsonReq({
      kind: 'GO_HALL', preview: true, studentId: student.id, item: 'SEASON_PASS',
      startDate: 'not-a-date', endDate: '2026-09-30', price: 3000,
    }) as never);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('INVALID_INPUT');
  });
});

describe('PATCH & DELETE /api/admin/billing/bills/[id] 弈廳分流', () => {
  function patchReq(body: unknown): Request {
    return new Request('http://localhost/api/admin/billing/bills/x', { method: 'PATCH', body: JSON.stringify(body) }) as never;
  }

  it('弈廳堂票帳單可改堂數並連動堂票餘額；DELETE 後帳單消失、餘額扣回', async () => {
    const student = await createStudent({ name: '小弈3', email: `gh-route-patch-${Date.now()}@example.com`, password: 'x' });
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 4, unitPrice: 250, amountDue: 1000, notifyNow: false });
    asAdmin();

    const patchRes = await updateBillPATCH(
      patchReq({ goHallTickets: 6, unitPrice: 250, amountDue: 1500, discounts: [] }) as never,
      { params: { id: billId } }
    );
    expect(patchRes.status).toBe(200);
    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(updated.goHallTickets).toBe(6);
    expect(await getTicketBalance(student.id)).toBe(6);

    const delRes = await deleteBillDELETE(new Request('http://localhost/api/admin/billing/bills/x', { method: 'DELETE' }) as never, { params: { id: billId } });
    expect(delRes.status).toBe(200);
    const gone = await prisma.bill.findUnique({ where: { id: billId } });
    expect(gone).toBeNull();
    expect(await getTicketBalance(student.id)).toBe(0);
  });

  it('弈廳季票帳單 PATCH startDate 格式錯誤回 400 INVALID_INPUT', async () => {
    const student = await createStudent({ name: '小弈4', email: `gh-route-patch-bad-${Date.now()}@example.com`, password: 'x' });
    const { billId } = await createGoHallBill({
      item: 'SEASON_PASS', studentId: student.id, startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T00:00:00Z'),
      price: 3000, amountDue: 3000, notifyNow: false,
    });
    asAdmin();
    const res = await updateBillPATCH(
      patchReq({ startDate: 'not-a-date', endDate: '2026-09-15', amountDue: 3000, discounts: [] }) as never,
      { params: { id: billId } }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
  });
});
