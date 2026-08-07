import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { decideMakeup } from '@/lib/services/tutoringBookingService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { decision } = await req.json().catch(() => ({}));
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  try {
    await decideMakeup(params.id, decision);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'BOOKING_NOT_FOUND' ? 404 : message === 'ALREADY_DECIDED' ? 409 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
