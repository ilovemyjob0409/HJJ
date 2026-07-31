import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPointBalances, listPointHistory } from '@/lib/services/pointService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let studentId: string;
  if (session.user.role === 'ADMIN') {
    const q = req.nextUrl.searchParams.get('studentId');
    if (!q) return NextResponse.json({ error: 'studentId required' }, { status: 400 });
    studentId = q;
  } else if (session.user.role === 'STUDENT') {
    // 學生一律查自己，不接受參數，避免查他人點數。
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    studentId = student.id;
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [balances, history] = await Promise.all([getPointBalances(studentId), listPointHistory(studentId)]);
  return NextResponse.json({ balances, history });
}
