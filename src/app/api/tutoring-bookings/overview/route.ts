import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listBookingsOverview, listMonthlyBookingCounts } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // ?month=YYYY-MM → 月曆總覽的每日人數統計；?date=YYYY-MM-DD → 單日名單
  const monthParam = req.nextUrl.searchParams.get('month');
  if (monthParam) {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) return NextResponse.json({ error: 'invalid month' }, { status: 400 });
    return NextResponse.json(await listMonthlyBookingCounts(monthParam));
  }
  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await listBookingsOverview(new Date(dateParam)));
}
