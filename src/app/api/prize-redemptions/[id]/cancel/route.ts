import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cancelRedemption } from '@/lib/services/prizeService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    if (session.user.role === 'ADMIN') {
      await cancelRedemption({ redemptionId: params.id, operator: session.user.name ?? '行政' });
    } else if (session.user.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
      if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      await cancelRedemption({ redemptionId: params.id, byStudentId: student.id, operator: '學生本人' });
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
