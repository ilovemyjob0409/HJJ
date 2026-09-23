import { prisma } from '@/lib/db';
import { classifyQuotaBookings, taipeiDateKey, utcDateKey } from './tutoringBookingService';

// 「應到未到、還沒補」的堂數（2026-09-23 使用者定案規則，見 spec 功能二）。

export interface ClassBacklogItem {
  date: string; // 'YYYY-MM-DD'
  reason: 'LEAVE' | 'ABSENT';
  makeupPending: boolean; // 請假已送補課、待行政核准
}
export interface ClassMakeupBacklog {
  count: number;
  items: ClassBacklogItem[]; // 新→舊
}
export interface TutoringMakeupBacklog {
  count: number; // 未補
  absentCount: number; // 本月缺席（含過期沒點名）
  rebooked: number; // 已另約＝absentCount − count
  absentDates: string[]; // 新→舊
}

export const backlogKey = (studentId: string, classId: string) => `${studentId}:${classId}`;

const EMPTY: ClassMakeupBacklog = { count: 0, items: [] };

// 班級（圍棋）：本期（最新一筆 EnrollmentPeriod 的 UTC 日曆日起）到台北今天，
// 以日期為單位——當天請假且補課不存在／被駁回／待審，或當天本班點名缺席，算一堂。
// 已核准補課的請假一律不算；請假後當天仍點了到場（非缺席、非請假）也不算。
// 插班補課寫進本班的點名紀錄（makeupRequestId 非 null）是別人的補課，排除。
export async function getClassMakeupBacklogs(
  pairs: { studentId: string; classId: string }[],
  now: Date = new Date()
): Promise<Map<string, ClassMakeupBacklog>> {
  const result = new Map<string, ClassMakeupBacklog>();
  if (pairs.length === 0) return result;
  const todayKey = taipeiDateKey(now);
  const todayUtc = new Date(`${todayKey}T00:00:00Z`);
  const studentIds = Array.from(new Set(pairs.map((p) => p.studentId)));
  const classIds = Array.from(new Set(pairs.map((p) => p.classId)));

  const enrollments = await prisma.classEnrollment.findMany({
    where: { studentId: { in: studentIds }, classId: { in: classIds } },
    // 只看堂數 > 0 的期別：刪除／修改帳單會補一筆負數的修正期別
    //（billingBatchService.deleteBill、billEditService），那不是新的一期，
    // 不能讓起算日往後跳、把未補清零。
    select: { studentId: true, classId: true, periods: { select: { createdAt: true }, where: { sessions: { gt: 0 } }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  const periodStart = new Map<string, string | null>();
  for (const e of enrollments) {
    const latest = e.periods[0];
    periodStart.set(backlogKey(e.studentId, e.classId), latest ? utcDateKey(latest.createdAt) : null);
  }
  const inPeriod = (key: string, date: string) => {
    const start = periodStart.get(key);
    return start === undefined ? false : start === null || date >= start;
  };

  // 查詢下限（優化用）：只要每個 pair 都有起算日，就用最早的起算日縮小查詢範圍；
  // 任一 pair 沒有期別（起算日為 null）就不設下限，維持現行行為——實際過濾仍靠
  // 上面 inPeriod，各 pair 用自己的起算日。
  const starts = pairs.map((p) => periodStart.get(backlogKey(p.studentId, p.classId)));
  const hasAllStarts = starts.every((s) => s !== undefined && s !== null);
  const earliestStart = hasAllStarts
    ? (starts as string[]).reduce((min, s) => (s < min ? s : min))
    : null;
  const earliestStartUtc = earliestStart ? new Date(`${earliestStart}T00:00:00Z`) : null;

  const [leaves, attendances] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        studentId: { in: studentIds },
        classId: { in: classIds },
        date: { lte: todayUtc, ...(earliestStartUtc ? { gte: earliestStartUtc } : {}) },
      },
      select: { studentId: true, classId: true, date: true, makeupRequest: { select: { status: true } } },
    }),
    prisma.classAttendance.findMany({
      where: {
        studentId: { in: studentIds },
        classId: { in: classIds },
        date: { lte: todayUtc, ...(earliestStartUtc ? { gte: earliestStartUtc } : {}) },
        makeupRequestId: null,
      },
      select: { studentId: true, classId: true, date: true, status: true },
    }),
  ]);

  // key → date → 當天狀態
  type Day = { leave?: 'OPEN' | 'PENDING' | 'APPROVED'; attendance?: string };
  const days = new Map<string, Map<string, Day>>();
  const dayOf = (key: string, date: string) => {
    let m = days.get(key);
    if (!m) days.set(key, (m = new Map()));
    let d = m.get(date);
    if (!d) m.set(date, (d = {}));
    return d;
  };
  for (const l of leaves) {
    const key = backlogKey(l.studentId, l.classId);
    const date = utcDateKey(l.date);
    if (!inPeriod(key, date)) continue;
    const s = l.makeupRequest?.status;
    dayOf(key, date).leave = s === 'APPROVED' ? 'APPROVED' : s === 'PENDING_ADMIN' ? 'PENDING' : 'OPEN';
  }
  for (const a of attendances) {
    const key = backlogKey(a.studentId, a.classId);
    const date = utcDateKey(a.date);
    if (!inPeriod(key, date)) continue;
    dayOf(key, date).attendance = a.status;
  }

  for (const p of pairs) {
    const key = backlogKey(p.studentId, p.classId);
    const m = days.get(key);
    if (!m) {
      result.set(key, EMPTY);
      continue;
    }
    const items: ClassBacklogItem[] = [];
    for (const [date, d] of Array.from(m.entries())) {
      if (d.leave === 'APPROVED') continue;
      if (d.attendance === 'ABSENT') {
        // 同一天請假待審、又被點缺席：原因仍記缺席，但補課待審的狀態要保留，
        // 讓畫面能顯示「缺席（補課待審）」。
        items.push({ date, reason: 'ABSENT', makeupPending: d.leave === 'PENDING' });
      } else if (
        (d.attendance === undefined || d.attendance === 'ON_LEAVE') &&
        (d.leave !== undefined || d.attendance === 'ON_LEAVE')
      ) {
        // 行政可能直接在點名面板標 ON_LEAVE、不另外建 LeaveRequest（d.leave 為
        // undefined），此時也算請假未補；makeupPending 只在真有 LeaveRequest
        // 且待審時才成立。但請假後當天若點了 LATE／LEFT_EARLY（人有到場）或
        // NOT_REGISTERED（未報名不該算），一律不算——只有「沒點名」或「點了
        // ON_LEAVE」才算請假未補。
        items.push({ date, reason: 'LEAVE', makeupPending: d.leave === 'PENDING' });
      }
    }
    items.sort((a, b) => (a.date < b.date ? 1 : -1));
    result.set(key, { count: items.length, items });
  }
  return result;
}

// 個別輔導（本月）：補課＝另約一般預約、兩筆無關聯（v8 條文），所以用額度推算——
// 缺席不扣堂會空出額度，另約補課會吃掉額度。未補＝min(缺席數, 還能約堂數)。
// bookings 需為該報名本月的 REGULAR 預約（同 listEnrollments / getMonthlyQuotaStatus 口徑）。
export function computeTutoringBacklog(
  bookings: { date: Date; status: string; attendance: { status: string } | null }[],
  quota: number,
  todayKey: string
): TutoringMakeupBacklog {
  const absentDates = bookings
    .filter(
      (b) =>
        b.status === 'BOOKED' &&
        utcDateKey(b.date) < todayKey &&
        (b.attendance === null || b.attendance.status === 'ABSENT')
    )
    .map((b) => utcDateKey(b.date))
    .sort((a, b) => (a < b ? 1 : -1));
  const { locked, upcoming, pendingOverQuota } = classifyQuotaBookings(bookings, todayKey);
  // 待審的超額預約也算已另約：一旦核准就會吃掉額度，先扣起來避免顯示未補
  // 又同時有一筆正在等審核的補課。
  const available = Math.max(0, quota - locked - upcoming - pendingOverQuota);
  const count = Math.min(absentDates.length, available);
  return { count, absentCount: absentDates.length, rebooked: absentDates.length - count, absentDates };
}
