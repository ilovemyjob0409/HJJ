import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveCheckIn } from '@/lib/services/attendanceService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { code, date, time, key } = await req.json();
  const result = await resolveCheckIn(code, date, time, session.user.id, key);
  return NextResponse.json(result);
}
