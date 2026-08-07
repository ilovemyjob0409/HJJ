import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createProgram, listPrograms } from '@/lib/services/tutoringProgramService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPrograms());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const program = await createProgram({
    name: body.name,
    defaultMonthlyQuota: body.defaultMonthlyQuota,
    defaultDurationMinutes: body.defaultDurationMinutes,
  });
  return NextResponse.json(program, { status: 201 });
}
