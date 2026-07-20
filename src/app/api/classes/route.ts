import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createClass, listClasses, listClassesForBooking, listStudentEnrolledClasses } from '@/lib/services/classService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role === 'ADMIN') return NextResponse.json(await listClasses());

  // Students only see classes they're enrolled in (see
  // src/app/student/leave-request/page.tsx), since leave requests now
  // require enrollment. Teachers keep the full booking-facing projection
  // (see src/app/teacher/leave-request/page.tsx) — they aren't enrolled
  // in classes themselves.
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
    if (!student) return NextResponse.json([]);
    return NextResponse.json(await listStudentEnrolledClasses(student.id));
  }

  return NextResponse.json(await listClassesForBooking());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const cls = await createClass(body);
  return NextResponse.json(cls, { status: 201 });
}
