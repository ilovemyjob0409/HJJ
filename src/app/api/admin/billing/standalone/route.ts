import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import {
  listStandaloneBills,
  previewStandaloneClassBill, createStandaloneClassBill,
  previewStandaloneTutoringBill, createStandaloneTutoringBill,
} from '@/lib/services/standaloneBillService';

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

// body: { kind: 'CLASS'|'TUTORING', preview: boolean, periodStart, periodEnd,
//         studentId?, classId?, enrollmentId?, billedSessions?, amountDue?, note?, notifyNow? }
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.kind || !body.periodStart || !body.periodEnd) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  try {
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    const discountItemIds: string[] | undefined = Array.isArray(body.discountItemIds) ? body.discountItemIds : undefined;
    if (body.kind === 'CLASS') {
      if (!body.studentId || !body.classId) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
      if (body.preview) {
        return NextResponse.json(
          await previewStandaloneClassBill({ studentId: body.studentId, classId: body.classId, periodStart, periodEnd, discountItemIds })
        );
      }
      const result = await createStandaloneClassBill({
        studentId: body.studentId, classId: body.classId, periodStart, periodEnd,
        billedSessions: body.billedSessions, amountDue: body.amountDue, note: body.note, notifyNow: !!body.notifyNow, discountItemIds,
      });
      return NextResponse.json(result);
    }
    if (!body.enrollmentId) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    if (body.preview) {
      return NextResponse.json(
        await previewStandaloneTutoringBill({ enrollmentId: body.enrollmentId, periodStart, periodEnd, discountItemIds })
      );
    }
    const result = await createStandaloneTutoringBill({
      enrollmentId: body.enrollmentId, periodStart, periodEnd,
      amountDue: body.amountDue, note: body.note, notifyNow: !!body.notifyNow, discountItemIds,
    });
    return NextResponse.json(result);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
