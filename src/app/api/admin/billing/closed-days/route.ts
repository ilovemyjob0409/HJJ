import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { seedNationalHolidays, listClosedDays, addClosedDay } from '@/lib/services/closedDayService';

// 首次呼叫先種國定假日（表為唯一來源，之後靠後台自行增補），再回完整清單。
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    await seedNationalHolidays();
    return NextResponse.json(await listClosedDays());
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.date || !body.name) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  try {
    const closedDay = await addClosedDay(new Date(body.date), body.name);
    return NextResponse.json(closedDay);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
