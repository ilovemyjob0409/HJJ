import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requestMakeup, decideMakeup } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'STUDENT' && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const original = await prisma.tutoringBooking.findUnique({
    where: { id: params.id },
    include: { enrollment: { select: { studentId: true } } },
  });
  if (!original) return NextResponse.json({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    if (original.enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.windowId || !body.date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  try {
    const makeup = await requestMakeup({
      originalBookingId: params.id,
      windowId: body.windowId,
      date: new Date(body.date),
    });
    if (session.user.role === 'ADMIN') {
      await decideMakeup(makeup.id, 'APPROVED');
    }
    return NextResponse.json(makeup, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status =
      message === 'WINDOW_FULL' || message === 'WINDOW_CLOSED' || message === 'ALREADY_REQUESTED' || message === 'ALREADY_BOOKED_SAME_DAY'
        ? 409
        : message === 'WINDOW_NOT_FOUND' || message === 'ENROLLMENT_NOT_FOUND'
          ? 404
          : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
