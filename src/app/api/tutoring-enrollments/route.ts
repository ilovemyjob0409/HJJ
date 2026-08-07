import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createEnrollment, listEnrollments } from '@/lib/services/tutoringProgramService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listEnrollments());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, programId, monthlyQuota } = await req.json();
  try {
    const enrollment = await createEnrollment({ studentId, programId, monthlyQuota });
    return NextResponse.json(enrollment, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_ENROLLED') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
