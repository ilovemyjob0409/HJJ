import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { maskName } from '@/lib/maskName';
import { getSessionDetail, getSessionDetailWithQualifications, deleteSession } from '@/lib/services/goHallService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.role !== 'STUDENT') {
    return NextResponse.json(await getSessionDetailWithQualifications(params.id));
  }

  const detail = await getSessionDetail(params.id);
  return NextResponse.json({
    ...detail,
    registrations: detail.registrations.map((r) => ({
      ...r,
      student: { user: { ...r.student.user, name: maskName(r.student.user.name) } },
    })),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteSession(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'SESSION_HAS_ATTENDANCE') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
