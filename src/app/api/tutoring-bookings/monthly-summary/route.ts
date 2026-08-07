import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listMonthlyAttendanceSummary } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const month = req.nextUrl.searchParams.get('month');
  if (!month) return NextResponse.json({ error: 'month required' }, { status: 400 });
  return NextResponse.json(await listMonthlyAttendanceSummary(month));
}
