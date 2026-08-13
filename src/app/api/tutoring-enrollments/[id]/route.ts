import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateEnrollment, deleteEnrollment } from '@/lib/services/tutoringProgramService';
import { getMonthlyQuotaStatus, taipeiDateKey, utcDateKey } from '@/lib/services/tutoringBookingService';
import { prisma } from '@/lib/db';

// 行政「新增預約」彈窗的額度條用：回這筆報名當月（台北）的額度狀態，
// 加上「未來所有有效預約」的日期清單——日曆只能標示還有窗口的日子，
// 落在已關閉窗口或重複疊在同一天的預約，靠這份清單才看得見。
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const quota = await getMonthlyQuotaStatus(params.id, taipeiDateKey(new Date()).slice(0, 7));
    const [ty, tm, td] = taipeiDateKey(new Date()).split('-').map(Number);
    const upcoming = await prisma.tutoringBooking.findMany({
      where: {
        enrollmentId: params.id,
        status: { in: ['BOOKED', 'PENDING_ADMIN'] },
        date: { gte: new Date(Date.UTC(ty, tm - 1, td)) },
      },
      select: { id: true, date: true, kind: true, status: true },
      orderBy: { date: 'asc' },
    });
    return NextResponse.json({
      ...quota,
      upcomingBookings: upcoming.map((b) => ({
        id: b.id,
        date: utcDateKey(b.date),
        kind: b.kind,
        status: b.status,
      })),
    });
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
