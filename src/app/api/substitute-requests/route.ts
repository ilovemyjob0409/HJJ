import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createSubstituteRequest, listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPendingSubstituteRequests());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
  const body = await req.json();
  const request = await createSubstituteRequest({
    classId: body.classId,
    originalTeacherId: teacher.id,
    date: new Date(body.date),
    reason: body.reason,
  });
  return NextResponse.json(request, { status: 201 });
}
