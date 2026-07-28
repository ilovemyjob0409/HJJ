import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getGoHallRoster, saveGoHallAttendance } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const goHallSession = await prisma.goHallSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: { teacherId: true },
    });
    if (goHallSession.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getGoHallRoster(params.sessionId));
}

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const goHallSession = await prisma.goHallSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: { teacherId: true },
    });
    if (goHallSession.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  await saveGoHallAttendance(params.sessionId, session.user.id, body.records);
  return NextResponse.json({ success: true });
}
