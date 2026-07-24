import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createActivity, listAllActivities, listActivitiesForTeacher, listOpenActivitiesForStudent } from '@/lib/services/activityService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.role === 'ADMIN') {
    return NextResponse.json(await listAllActivities());
  }
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    return NextResponse.json(await listActivitiesForTeacher(teacher.id));
  }
  return NextResponse.json(await listOpenActivitiesForStudent());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const created = await createActivity({
    title: body.title,
    description: body.description,
    category: body.category,
    location: body.location || undefined,
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
    capacity: Number(body.capacity),
    teacherId: body.teacherId || undefined,
  });
  return NextResponse.json(created, { status: 201 });
}
