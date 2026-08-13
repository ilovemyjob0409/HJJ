import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateEnrollment, deleteEnrollment } from '@/lib/services/tutoringProgramService';
import { getMonthlyQuotaStatus, taipeiDateKey } from '@/lib/services/tutoringBookingService';

// 行政「新增預約」彈窗的額度條用：回這筆報名當月（台北）的額度狀態
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json(await getMonthlyQuotaStatus(params.id, taipeiDateKey(new Date()).slice(0, 7)));
  } catch (err) {
    if (err instanceof Error && err.message === 'ENROLLMENT_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  try {
    const enrollment = await updateEnrollment(params.id, body);
    return NextResponse.json(enrollment);
  } catch (err) {
    if (err instanceof Error && err.message === 'ENROLLMENT_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteEnrollment(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'ENROLLMENT_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
