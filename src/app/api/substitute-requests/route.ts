import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  adminCreateSubstituteRequest,
  createSubstituteRequest,
  listPendingSubstituteRequests,
} from '@/lib/services/substituteRequestService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPendingSubstituteRequests());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'TEACHER' && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  try {
    // 行政幫老師請假：原老師取自班級，可同時直接指派代課老師。
    if (session.user.role === 'ADMIN') {
      const request = await adminCreateSubstituteRequest({
        classId: body.classId,
        date: new Date(body.date),
        reason: body.reason,
        substituteTeacherId: body.substituteTeacherId || undefined,
      });
      return NextResponse.json(request, { status: 201 });
    }
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const request = await createSubstituteRequest({
      classId: body.classId,
      originalTeacherId: teacher.id,
      date: new Date(body.date),
      reason: body.reason,
    });
    return NextResponse.json(request, { status: 201 });
  } catch (err) {
    // 只回傳已知業務錯誤碼，其他一律 500，避免外洩原始 Prisma 錯誤。
    const message = err instanceof Error ? err.message : '';
    if (message === 'INVALID_WEEKDAY') return NextResponse.json({ error: message }, { status: 422 });
    console.error('POST /api/substitute-requests failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
