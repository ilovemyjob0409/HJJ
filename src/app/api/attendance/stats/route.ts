import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttendanceStats } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });

  const stats = await getAttendanceStats({
    studentId: params.get('studentId') ?? undefined,
    classId: params.get('classId') ?? undefined,
    from: new Date(from),
    to: new Date(to),
  });
  return NextResponse.json(stats);
}
