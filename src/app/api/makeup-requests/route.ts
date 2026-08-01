import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listClassesBySubjectAndLevel } from '@/lib/services/classService';
import { listTeacherAvailability } from '@/lib/services/availabilityService';
import { createInsertionMakeupRequest, createOneOnOneMakeupRequest, getMakeupQuotaStatus } from '@/lib/services/makeupRequestService';

// Fetches the leave request and verifies it belongs to the given student.
// Returns null (rather than throwing) when missing or owned by someone else,
// so callers can respond with a generic 404 instead of confirming the ID exists.
async function findOwnLeaveRequest(leaveRequestId: string, studentId: string) {
  const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveRequestId }, include: { class: true } });
  if (!leave || leave.studentId !== studentId) return null;
  return leave;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  // 老師可補課時段查詢：學生（申請補課頁）與行政（代排補課表單）都會用。
  const teacherId = req.nextUrl.searchParams.get('teacherId');
  if (teacherId) {
    if (!session || (session.user.role !== 'STUDENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const availability = await listTeacherAvailability(teacherId);
    return NextResponse.json({ availability });
  }

  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const leaveRequestId = req.nextUrl.searchParams.get('leaveRequestId');
  if (!leaveRequestId) return NextResponse.json({ error: 'leaveRequestId or teacherId required' }, { status: 400 });

  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const leave = await findOwnLeaveRequest(leaveRequestId, student.id);
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  const quota = await getMakeupQuotaStatus(student.id, leave.classId);
  return NextResponse.json({ eligibleClasses, quota });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const body = await req.json();

  const leave = await findOwnLeaveRequest(body.leaveRequestId, student.id);
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
