import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getOneOnOneAttendance, saveOneOnOneAttendance } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { makeupRequestId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const makeupRequest = await prisma.makeupRequest.findUniqueOrThrow({
      where: { id: params.makeupRequestId },
      select: { teacherId: true },
    });
    if (makeupRequest.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getOneOnOneAttendance(params.makeupRequestId));
}

export async function POST(req: NextRequest, { params }: { params: { makeupRequestId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const makeupRequest = await prisma.makeupRequest.findUniqueOrThrow({
      where: { id: params.makeupRequestId },
      select: { teacherId: true },
    });
    if (makeupRequest.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  await saveOneOnOneAttendance(params.makeupRequestId, session.user.id, {
    status: body.status,
    checkInTime: body.checkInTime,
    checkOutTime: body.checkOutTime,
  });
  return NextResponse.json({ success: true });
}
