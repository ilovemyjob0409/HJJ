import { describe, it, expect, beforeEach, vi } from 'vitest';

const adminMock = vi.fn();
vi.mock('@/lib/apiGuards', () => ({ requireAdmin: () => adminMock() }));

import { POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';

beforeEach(() => {
  adminMock.mockReset();
  adminMock.mockResolvedValue(true);
});

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: `sb-route-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  const student = await createStudent({ name: '王小強', email: `sb-route-s-${Date.now()}@example.com`, password: 'x' });
  await enrollStudent(cls.id, student.id);
  return { cls, student };
}

function post(body: unknown) {
  return POST(new Request('http://x/api/admin/billing/standalone', { method: 'POST', body: JSON.stringify(body) }) as never);
}

describe('POST /api/admin/billing/standalone discounts validation', () => {
  it('403 when not admin', async () => {
    adminMock.mockResolvedValue(false);
    expect((await post({ kind: 'CLASS', preview: true, periodStart: '2026-09-01', periodEnd: '2026-09-30' })).status).toBe(403);
  });

  it('400 INVALID_DISCOUNTS for malformed discount rows', async () => {
    const { cls, student } = await setup();
    const base = { kind: 'CLASS', preview: true, periodStart: '2026-09-01', periodEnd: '2026-09-30', studentId: student.id, classId: cls.id };
    for (const discounts of [
      'not-an-array',
      [{ name: '', amount: 100 }], // 名稱空白
      [{ name: '特約', amount: 0 }], // 金額須為正
      [{ name: '特約', amount: 1.5 }], // 金額須為整數
      [{ name: '特約' }], // 缺金額
    ]) {
      const res = await post({ ...base, discounts });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('INVALID_DISCOUNTS');
    }
  });

  it('200 preview applies free-form discounts (names trimmed)', async () => {
    const { cls, student } = await setup();
    const res = await post({
      kind: 'CLASS', preview: true, periodStart: '2026-09-01', periodEnd: '2026-09-30', studentId: student.id, classId: cls.id,
      discounts: [{ name: ' 台積電特約 ', amount: 500 }, { name: '手足同行', amount: 100 }],
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // 4 堂 × 500 = 2000 − 500 − 100 = 1400
    expect(data.amountDue).toBe(1400);
    expect(data.detail.discounts).toEqual([
      { name: '台積電特約', amount: 500 },
      { name: '手足同行', amount: 100 },
    ]);
  });
});
