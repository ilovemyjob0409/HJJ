import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listBookingsOverview } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await listBookingsOverview(new Date(dateParam)));
}
