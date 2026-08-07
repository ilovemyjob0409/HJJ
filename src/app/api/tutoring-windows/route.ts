import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createWindow } from '@/lib/services/tutoringProgramService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const window = await createWindow({
    programId: body.programId,
    weekday: Number(body.weekday),
    startTime: body.startTime,
    endTime: body.endTime,
    capacity: Number(body.capacity),
    teacherId: body.teacherId,
  });
  return NextResponse.json(window, { status: 201 });
}
