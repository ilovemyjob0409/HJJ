import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listClassesBySubjectAndLevel } from '@/lib/services/classService';
import { listTeacherAvailability } from '@/lib/services/availabilityService';
import { createInsertionMakeupRequest, createOneOnOneMakeupRequest } from '@/lib/services/makeupRequestService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const teacherId = req.nextUrl.searchParams.get('teacherId');
  if (teacherId) {
    const availability = await listTeacherAvailability(teacherId);
    return NextResponse.json({ availability });
  }

  const leaveRequestId = req.nextUrl.searchParams.get('leaveRequestId');
  if (!leaveRequestId) return NextResponse.json({ error: 'leaveRequestId or teacherId required' }, { status: 400 });

  const leave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId }, include: { class: true } });
  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  return NextResponse.json({ eligibleClasses });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const body = await req.json();

  try {
    if (body.type === 'INSERTION') {
      const makeup = await createInsertionMakeupRequest({
        leaveRequestId: body.leaveRequestId,
        targetClassId: body.targetClassId,
        targetDate: new Date(body.targetDate),
      });
      return NextResponse.json(makeup, { status: 201 });
    }

    if (body.type === 'ONE_ON_ONE') {
      const makeup = await createOneOnOneMakeupRequest({
        leaveRequestId: body.leaveRequestId,
        studentId: student.id,
        teacherId: body.teacherId,
        slotDate: new Date(body.slotDate),
        slotStartTime: body.slotStartTime,
        slotEndTime: body.slotEndTime,
      });
      return NextResponse.json(makeup, { status: 201 });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
