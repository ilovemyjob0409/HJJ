import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringDeductionLedger } from '@/lib/services/tutoringBookingService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: params.id } });
  if (!enrollment || enrollment.studentId !== student.id) {
    return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json(await getTutoringDeductionLedger(params.id));
}
