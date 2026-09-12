import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { backfillClassAttendance } from '@/lib/services/attendanceService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { items } = await req.json();
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      !items.every((i) => i && typeof i.classId === 'string' && typeof i.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date))
    ) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const result = await backfillClassAttendance(params.id, session.user.id, items);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    console.error('POST /api/students/[id]/attendance/backfill failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
