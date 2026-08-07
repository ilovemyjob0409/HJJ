import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createWalkInBooking } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.enrollmentId || !body.windowId || !body.date || !body.startTime || !body.endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  try {
    const booking = await createWalkInBooking({
      enrollmentId: body.enrollmentId,
      windowId: body.windowId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime: body.endTime,
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'ENROLLMENT_NOT_FOUND' || message === 'WINDOW_NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
