import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { arrangeInsertionMakeup, arrangeOneOnOneMakeup } from '@/lib/services/makeupRequestService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const base = {
    studentId: body.studentId as string,
    classId: body.classId as string,
    date: new Date(body.date),
    reason: (body.reason as string)?.trim() || '行政代辦',
  };
  try {
    if (body.type === 'INSERTION') {
      const makeup = await arrangeInsertionMakeup({
        ...base,
        targetClassId: body.targetClassId,
        targetDate: new Date(body.targetDate),
      });
      return NextResponse.json(makeup, { status: 201 });
    }
    if (body.type === 'ONE_ON_ONE') {
      const makeup = await arrangeOneOnOneMakeup({
        ...base,
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
