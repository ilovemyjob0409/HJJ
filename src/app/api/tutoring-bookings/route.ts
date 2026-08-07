import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createBooking, listBookingsForStudent } from '@/lib/services/tutoringBookingService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  return NextResponse.json(await listBookingsForStudent(student.id));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (!body.enrollmentId || !body.windowId || !body.date || !body.startTime || !body.endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  let enrollmentId: string = body.enrollmentId;

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: body.enrollmentId } });
    if (!enrollment) return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
    if (enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    enrollmentId = enrollment.id;
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const booking = await createBooking({
      enrollmentId,
      windowId: body.windowId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime: body.endTime,
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status =
      message === 'WINDOW_FULL' || message === 'WINDOW_CLOSED'
        ? 409
        : message === 'WINDOW_NOT_FOUND' || message === 'ENROLLMENT_NOT_FOUND'
          ? 404
          : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
