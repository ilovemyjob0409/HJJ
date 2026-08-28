import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { createDiscountItem } from '@/lib/services/discountItemService';

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.name || body.amount === undefined) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }
  try {
    const item = await createDiscountItem({ name: body.name, amount: body.amount });
    return NextResponse.json(item);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
