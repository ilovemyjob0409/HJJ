import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringWindowAttendanceOverview } from '@/lib/services/attendanceService';
import { taipeiDateKey } from '@/lib/services/tutoringBookingService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role !== 'ADMIN' && session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const window = await prisma.tutoringWindow.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacherId: true,
      teacherId2: true,
      program: { select: { name: true } },
      teacher: { select: { user: { select: { name: true } } } },
      teacher2: { select: { user: { select: { name: true } } } },
    },
  });
  if (!window) return NextResponse.json({ error: 'WINDOW_NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    if (window.teacherId !== teacher.id && window.teacherId2 !== teacher.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const students = await getTutoringWindowAttendanceOverview(window.id);
  return NextResponse.json({
    window: {
      id: window.id,
      weekday: window.weekday,
      startTime: window.startTime,
      endTime: window.endTime,
      programName: window.program.name,
      teacherName: window.teacher.user.name,
      teacherName2: window.teacher2?.user.name ?? null,
    },
    todayKey: taipeiDateKey(new Date()),
    students,
  });
}
