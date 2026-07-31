import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { awardPoints } from '@/lib/services/pointService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'TEACHER' && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // 老師加分記錄操作老師；行政加分不綁老師。
  const teacher =
    session.user.role === 'TEACHER' ? await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } }) : null;
  const { studentIds, amount, reasonId } = await req.json();
  try {
    await awardPoints({ teacherId: teacher?.id ?? null, studentIds, amount, reasonId });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
