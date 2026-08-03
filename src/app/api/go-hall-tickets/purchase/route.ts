import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { purchaseTickets } from '@/lib/services/goHallTicketService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, sessions } = await req.json();
  try {
    await purchaseTickets({ studentId, sessions });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
