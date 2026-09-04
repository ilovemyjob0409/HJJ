import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { transferEnrollment } from '@/lib/services/classService';

// 換班：把 params.id（原班）的報名搬到 toClassId，剩餘堂數與覆寫價一併帶過去。
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, toClassId } = await req.json();
  if (typeof studentId !== 'string' || typeof toClassId !== 'string') {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 422 });
  }
  try {
    const created = await transferEnrollment(params.id, toClassId, studentId);
    return NextResponse.json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
