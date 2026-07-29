import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getClassRoster, saveClassAttendance, getClassEnrollmentQuota, clearClassAttendance } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest, { params }: { params: { classId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const cls = await prisma.class.findUniqueOrThrow({ where: { id: params.classId }, select: { teacherId: true } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  const date = new Date(dateParam);

  const roster = await getClassRoster(params.classId, date);
  const homeStudents = roster.filter((r) => r.makeupRequestId === null);
  const quotas = await Promise.all(homeStudents.map((r) => getClassEnrollmentQuota(params.classId, r.studentId)));
  const quotaByStudentId = Object.fromEntries(homeStudents.map((r, i) => [r.studentId, quotas[i]]));

  return NextResponse.json({ roster, quotaByStudentId });
}

export async function POST(req: NextRequest, { params }: { params: { classId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const cls = await prisma.class.findUniqueOrThrow({ where: { id: params.classId }, select: { teacherId: true } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  await saveClassAttendance(params.classId, new Date(body.date), session.user.id, body.records);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { classId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const cls = await prisma.class.findUniqueOrThrow({ where: { id: params.classId }, select: { teacherId: true } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  await clearClassAttendance(params.classId, new Date(body.date), body.clear ?? []);
  return NextResponse.json({ success: true });
}
