import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { maskName } from '@/lib/maskName';
import { getActivityDetail, deleteActivity, updateActivity } from '@/lib/services/activityService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const detail = await getActivityDetail(params.id);
  if (session.user.role !== 'STUDENT') {
    return NextResponse.json(detail);
  }

  return NextResponse.json({
    ...detail,
    registrations: detail.registrations.map((r) => ({
      ...r,
      student: { user: { ...r.student.user, name: maskName(r.student.user.name) } },
    })),
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const teacherIds: string[] = Array.isArray(body.teacherIds) ? body.teacherIds : [];
  if (teacherIds.length === 0) {
    return NextResponse.json({ error: 'TEACHER_REQUIRED' }, { status: 400 });
  }
  const updated = await updateActivity(params.id, {
    title: body.title,
    description: body.description,
    categoryId: body.categoryId,
    location: body.location || undefined,
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
    capacity: Number(body.capacity),
    teacherIds,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteActivity(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'ACTIVITY_HAS_ATTENDANCE') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
