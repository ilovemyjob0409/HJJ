import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { addPayment } from '@/lib/services/billPaymentService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.amount || !body.paidOn || !body.method) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  try {
    await addPayment(params.id, {
      amount: body.amount,
      paidOn: new Date(body.paidOn),
      method: body.method,
      note: body.note,
    }, session.user.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
