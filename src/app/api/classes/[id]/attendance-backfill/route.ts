import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { backfillClassAttendanceCells } from '@/lib/services/attendanceService';

// 出缺勤總表的格子補登（行政限定，同學生管理「補簽到」的權限）。
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { items } = await req.json();
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      !items.every((i) => i && typeof i.studentId === 'string' && typeof i.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date))
    ) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const result = await backfillClassAttendanceCells(params.id, session.user.id, items);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'CLASS_NOT_FOUND') return NextResponse.json({ error: message }, { status: 404 });
    if (message === 'INVALID_DATE' || message === 'NOT_ENROLLED') return NextResponse.json({ error: message }, { status: 422 });
    console.error('POST /api/classes/[id]/attendance-backfill failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
