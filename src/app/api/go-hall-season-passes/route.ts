import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addSeasonPass } from '@/lib/services/goHallTicketService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, startDate, endDate } = await req.json();
  try {
    const pass = await addSeasonPass({ studentId, startDate: new Date(startDate), endDate: new Date(endDate) });
    return NextResponse.json(pass, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
