import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import {
  listStandaloneBills,
  previewStandaloneClassBill, createStandaloneClassBill,
  previewStandaloneTutoringBill, createStandaloneTutoringBill,
} from '@/lib/services/standaloneBillService';
import { previewGoHallBill, createGoHallBill, type GoHallBillInput } from '@/lib/services/goHallBillService';

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await listStandaloneBills());
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

// body: { kind: 'CLASS'|'TUTORING'|'GO_HALL', preview: boolean, periodStart, periodEnd,
//         studentId?, classId?, enrollmentId?, billedSessions?, amountDue?, note?, notifyNow?,
//         discounts?: {name, amount}[] }（優惠由行政試算前自行輸入，可自訂項目）
// GO_HALL：不需要 periodStart／periodEnd；改帶 item: 'TICKETS'|'SEASON_PASS'，
//   TICKETS 帶 sessions/unitPrice，SEASON_PASS 帶 startDate/endDate/price。
function parseDiscounts(raw: unknown): { ok: true; discounts?: { name: string; amount: number }[] } | { ok: false } {
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw)) return { ok: false };
  const discounts: { name: string; amount: number }[] = [];
  for (const d of raw) {
    if (
      d === null || typeof d !== 'object' ||
      typeof (d as { name?: unknown }).name !== 'string' || (d as { name: string }).name.trim() === '' ||
      !Number.isInteger((d as { amount?: unknown }).amount) || (d as { amount: number }).amount <= 0
    ) {
      return { ok: false };
    }
    discounts.push({ name: (d as { name: string }).name.trim(), amount: (d as { amount: number }).amount });
  }
  return { ok: true, discounts };
}
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // 弈廳（堂票／季票）獨立分流：不需要 periodStart／periodEnd，開單即入帳，
  // 邏輯全在 goHallBillService（見該檔頭註解）。
  if (body.kind === 'GO_HALL') {
    if (!body.studentId || (body.item !== 'TICKETS' && body.item !== 'SEASON_PASS')) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    }
    if (body.item === 'SEASON_PASS' && (!body.startDate || !body.endDate)) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    }
    const parsedDiscounts = parseDiscounts(body.discounts);
    if (!parsedDiscounts.ok) return NextResponse.json({ error: 'INVALID_DISCOUNTS' }, { status: 400 });
    let spec: GoHallBillInput;
    if (body.item === 'TICKETS') {
      spec = { item: 'TICKETS', studentId: body.studentId, sessions: Number(body.sessions), unitPrice: Number(body.unitPrice), discounts: parsedDiscounts.discounts };
    } else {
      const startDate = new Date(body.startDate);
      const endDate = new Date(body.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
      }
      spec = { item: 'SEASON_PASS', studentId: body.studentId, startDate, endDate, price: Number(body.price), discounts: parsedDiscounts.discounts };
    }
    try {
      if (body.preview) return NextResponse.json(previewGoHallBill(spec));
      return NextResponse.json(
        await createGoHallBill({ ...spec, amountDue: Number(body.amountDue), note: body.note, notifyNow: !!body.notifyNow })
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : 'INTERNAL';
      if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    }
  }

  if (!body.kind || !body.periodStart || !body.periodEnd) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  try {
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    const parsed = parseDiscounts(body.discounts);
    if (!parsed.ok) return NextResponse.json({ error: 'INVALID_DISCOUNTS' }, { status: 400 });
    const discounts = parsed.discounts;
    if (body.kind === 'CLASS') {
      if (!body.studentId || !body.classId) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
      if (body.preview) {
        return NextResponse.json(
          await previewStandaloneClassBill({ studentId: body.studentId, classId: body.classId, periodStart, periodEnd, discounts })
        );
      }
      const result = await createStandaloneClassBill({
        studentId: body.studentId, classId: body.classId, periodStart, periodEnd,
        billedSessions: body.billedSessions, amountDue: body.amountDue, note: body.note, notifyNow: !!body.notifyNow, discounts,
      });
      return NextResponse.json(result);
    }
    if (!body.enrollmentId) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    if (body.preview) {
      return NextResponse.json(
        await previewStandaloneTutoringBill({ enrollmentId: body.enrollmentId, periodStart, periodEnd, discounts })
      );
    }
    const result = await createStandaloneTutoringBill({
      enrollmentId: body.enrollmentId, periodStart, periodEnd,
      amountDue: body.amountDue, note: body.note, notifyNow: !!body.notifyNow, discounts,
    });
    return NextResponse.json(result);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
