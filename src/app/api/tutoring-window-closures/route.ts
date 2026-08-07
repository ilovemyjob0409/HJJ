import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addWindowClosure } from '@/lib/services/tutoringProgramService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { windowId, date } = await req.json();
  const closure = await addWindowClosure(windowId, new Date(date));
  return NextResponse.json(closure, { status: 201 });
}
