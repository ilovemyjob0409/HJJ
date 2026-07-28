import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getActivityRoster, saveActivityAttendance } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest, { params }: { params: { activityId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const isAssigned = await prisma.activityTeacher.findFirst({
      where: { activityId: params.activityId, teacherId: teacher.id },
    });
    if (!isAssigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await getActivityRoster(params.activityId, new Date(dateParam)));
}

export async function POST(req: NextRequest, { params }: { params: { activityId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const isAssigned = await prisma.activityTeacher.findFirst({
      where: { activityId: params.activityId, teacherId: teacher.id },
    });
    if (!isAssigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });
  await saveActivityAttendance(params.activityId, new Date(body.date), session.user.id, body.records);
  return NextResponse.json({ success: true });
}
