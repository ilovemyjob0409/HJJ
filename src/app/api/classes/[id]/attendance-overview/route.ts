import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getClassAttendanceOverview } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role !== 'ADMIN' && session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cls = await prisma.class.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      subject: true,
      level: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacherId: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
  });
  if (!cls) return NextResponse.json({ error: 'CLASS_NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const students = await getClassAttendanceOverview(cls.id);
  return NextResponse.json({
    class: {
      id: cls.id,
      name: cls.name,
      subject: cls.subject,
      level: cls.level,
      weekday: cls.weekday,
      startTime: cls.startTime,
      endTime: cls.endTime,
      teacherName: cls.teacher.user.name,
    },
    students,
  });
}
