import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getClassAttendanceLedger } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  try {
    return NextResponse.json(await getClassAttendanceLedger(params.id, student.id));
  } catch {
    // studentId 是從 session 帶出來的，只有真的沒選這堂課才會查不到——
    // 不是權限問題（不會查得到別人的），是這堂課根本跟這位學生無關。
    return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
  }
}
