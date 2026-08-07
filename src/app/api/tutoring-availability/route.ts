import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listAvailability, daysRemainingInTaipeiMonth } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const enrollmentId = req.nextUrl.searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });

  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
  if (enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const days = daysRemainingInTaipeiMonth(new Date());
  return NextResponse.json(await listAvailability(enrollmentId, days));
}
