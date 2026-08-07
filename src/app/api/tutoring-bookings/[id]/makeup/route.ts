import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requestMakeup } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const original = await prisma.tutoringBooking.findUnique({
    where: { id: params.id },
    include: { enrollment: { select: { studentId: true } } },
  });
  if (!original) return NextResponse.json({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });
  if (original.enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (!body.windowId || !body.date || !body.startTime || !body.endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  try {
    const makeup = await requestMakeup({
      originalBookingId: params.id,
      windowId: body.windowId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime: body.endTime,
    });
    return NextResponse.json(makeup, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'WINDOW_FULL' || message === 'WINDOW_CLOSED' || message === 'ALREADY_REQUESTED' ? 409 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
