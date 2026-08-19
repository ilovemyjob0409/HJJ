import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringEnrollmentAttendance } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'STUDENT')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: params.id } });
    if (!enrollment || enrollment.studentId !== student.id) {
      return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
    }
  }
  try {
    return NextResponse.json(await getTutoringEnrollmentAttendance(params.id));
  } catch (e) {
    if (e instanceof Error && e.message === 'ENROLLMENT_NOT_FOUND') {
      return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
    }
    throw e;
  }
}
