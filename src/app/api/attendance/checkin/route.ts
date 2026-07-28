import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkInByStudentNumber } from '@/lib/services/attendanceService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { code, date, time } = await req.json();
  const result = await checkInByStudentNumber(code, date, time, session.user.id);
  return NextResponse.json(result);
}
