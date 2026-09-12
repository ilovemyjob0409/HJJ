import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  listMyAttendance,
  listClassBackfillDates,
  updateStudentAttendance,
  type AttendanceSessionType,
} from '@/lib/services/attendanceService';
import { isValidTimeValue } from '@/lib/timeFormat';

const TYPES: AttendanceSessionType[] = ['CLASS', 'ONE_ON_ONE', 'GO_HALL', 'ACTIVITY', 'TUTORING'];
// 各類型允許的狀態（照點名選項精簡慣例）；NONE＝清成未點名
const STATUS_BY_TYPE: Record<AttendanceSessionType, Set<string>> = {
  CLASS: new Set(['NONE', 'PRESENT', 'ON_LEAVE', 'ABSENT', 'NOT_REGISTERED']),
  ONE_ON_ONE: new Set(['NONE', 'PRESENT']),
  GO_HALL: new Set(['NONE', 'PRESENT']),
  ACTIVITY: new Set(['NONE', 'PRESENT']),
  TUTORING: new Set(['NONE', 'PRESENT']),
};

function invalidTime(value: unknown): boolean {
  return value !== null && (typeof value !== 'string' || !isValidTimeValue(value));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [rows, backfill] = await Promise.all([listMyAttendance(params.id), listClassBackfillDates(params.id)]);
  return NextResponse.json({ rows, backfill });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json();
    const { type, date, status, checkInTime = null, checkOutTime = null, classId, makeupRequestId, sessionId, activityId, windowId, bookingId } = body ?? {};
    if (
      !TYPES.includes(type) ||
      typeof date !== 'string' ||
      !STATUS_BY_TYPE[type as AttendanceSessionType].has(status) ||
      invalidTime(checkInTime) ||
      invalidTime(checkOutTime)
    ) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    await updateStudentAttendance({
      studentId: params.id,
      markedById: session.user.id,
      type,
      date: new Date(date),
      status,
      checkInTime,
      checkOutTime,
      classId,
      makeupRequestId,
      sessionId,
      activityId,
      windowId,
      bookingId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    const message = err instanceof Error ? err.message : '';
    if (message === 'MISSING_REF') return NextResponse.json({ error: message }, { status: 400 });
    console.error('PATCH /api/students/[id]/attendance failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
