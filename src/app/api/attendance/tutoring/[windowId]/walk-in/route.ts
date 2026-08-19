import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createBooking, listWalkInCandidates } from '@/lib/services/tutoringBookingService';

// 點名視窗的「現場加入」：老師（該時段的主/第二老師）與行政都可用。
async function authorize(windowId: string) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUnique({ where: { id: windowId } });
    if (!window) return { error: NextResponse.json({ error: 'WINDOW_NOT_FOUND' }, { status: 404 }) };
    if (window.teacherId !== teacher.id && window.teacherId2 !== teacher.id) {
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
  } else if (session.user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { error: null };
}

export async function GET(req: NextRequest, { params }: { params: { windowId: string } }) {
  const { error } = await authorize(params.windowId);
  if (error) return error;

  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  const date = new Date(dateParam);

  try {
    const [candidates, window, booked] = await Promise.all([
      listWalkInCandidates(params.windowId, date),
      prisma.tutoringWindow.findUniqueOrThrow({ where: { id: params.windowId }, select: { capacity: true } }),
      prisma.tutoringBooking.count({
        where: { windowId: params.windowId, date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
      }),
    ]);
    return NextResponse.json({ candidates, booked, capacity: window.capacity });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { windowId: string } }) {
  const { error } = await authorize(params.windowId);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  if (!body.enrollmentId || !body.date) {
    return NextResponse.json({ error: 'enrollmentId and date required' }, { status: 400 });
  }

  try {
    const booking = await createBooking({
      enrollmentId: body.enrollmentId,
      windowId: params.windowId,
      date: new Date(body.date),
      allowOverCapacity: body.force === true,
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
