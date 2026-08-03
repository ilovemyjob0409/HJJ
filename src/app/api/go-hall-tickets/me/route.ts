import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getMyTickets } from '@/lib/services/goHallTicketService';
import { listClassQuotaSummaries } from '@/lib/services/attendanceService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const [tickets, classQuotas] = await Promise.all([getMyTickets(student.id), listClassQuotaSummaries(student.id)]);
  return NextResponse.json({ ...tickets, classQuotas });
}
