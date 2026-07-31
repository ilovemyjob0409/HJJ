import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { awardPoints } from '@/lib/services/pointService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
  const { studentIds, amount, reasonId } = await req.json();
  try {
    await awardPoints({ teacherId: teacher.id, studentIds, amount, reasonId });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
