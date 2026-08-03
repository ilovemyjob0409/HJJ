import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTicketDetail } from '@/lib/services/goHallTicketService';

export async function GET(_req: NextRequest, { params }: { params: { studentId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getTicketDetail(params.studentId));
}
