import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requestMakeupCancellation } from '@/lib/services/makeupRequestService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  try {
    await requestMakeupCancellation(params.id, student.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
