import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createLeaveRequest, listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json([], { status: 200 });
  return NextResponse.json(await listLeaveRequestsForStudent(student.id));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json({ error: 'Not a student' }, { status: 400 });

  const body = await req.json();
  const leave = await createLeaveRequest({
    studentId: student.id,
    classId: body.classId,
    date: new Date(body.date),
    reason: body.reason,
  });
  return NextResponse.json(leave, { status: 201 });
}
