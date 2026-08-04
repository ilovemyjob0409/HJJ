import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revokeLeaveRequest } from '@/lib/services/leaveRequestService';

// 撤銷請假：學生撤自己的、老師撤自己帶班班級學生的、行政不限。
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const leave = await prisma.leaveRequest.findUnique({
    where: { id: params.id },
    select: { id: true, studentId: true, class: { select: { teacherId: true } } },
  });
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const role = session.user.role;
  if (role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
    if (!student || student.id !== leave.studentId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (role === 'TEACHER') {
    const teacher = await prisma.teacher.findUnique({ where: { userId: session.user.id } });
    if (!teacher || teacher.id !== leave.class.teacherId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await revokeLeaveRequest(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
