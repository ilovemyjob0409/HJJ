import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cancelBooking, adminCancelBooking } from '@/lib/services/tutoringBookingService';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'ADMIN') {
    const body = await req.json().catch(() => ({}));
    try {
      await adminCancelBooking(params.id, Boolean(body.countsTowardQuota));
      return NextResponse.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'BOOKING_NOT_FOUND') {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      throw err;
    }
  }
  if (session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  try {
    await cancelBooking(params.id, student.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'NOT_OWNER' ? 403 : message === 'BOOKING_NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
