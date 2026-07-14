import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { setTeacherAvailability, listTeacherAvailability } from '@/lib/services/availabilityService';

async function getTeacherForSession(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json([], { status: 200 });
  return NextResponse.json(await listTeacherAvailability(teacher.id));
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json({ error: 'Not a teacher' }, { status: 400 });

  const { windows } = await req.json();
  const result = await setTeacherAvailability(teacher.id, windows);
  return NextResponse.json(result);
}
