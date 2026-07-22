import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createSessions, listAllSessions, listSessionsForTeacher, listOpenSessionsForStudent } from '@/lib/services/goHallService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.role === 'ADMIN') {
    return NextResponse.json(await listAllSessions());
  }
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    return NextResponse.json(await listSessionsForTeacher(teacher.id));
  }
  return NextResponse.json(await listOpenSessionsForStudent());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const created = await createSessions({
    dates: body.dates.map((d: string) => new Date(d)),
    startTime: body.startTime,
    endTime: body.endTime,
    capacity: Number(body.capacity),
    teacherId: body.teacherId,
  });
  return NextResponse.json(created, { status: 201 });
}
