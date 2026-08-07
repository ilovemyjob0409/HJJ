import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createWalkInBooking } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const booking = await createWalkInBooking({
    enrollmentId: body.enrollmentId,
    windowId: body.windowId,
    date: new Date(body.date),
    startTime: body.startTime,
    endTime: body.endTime,
  });
  return NextResponse.json(booking, { status: 201 });
}
