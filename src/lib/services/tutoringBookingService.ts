import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { pushToUser, pushToUsers, hasPushSubscription } from './pushService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date);
}

export function daysRemainingInTaipeiMonth(now: Date): number {
  const todayKey = taipeiDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDayOfMonth - d + 1;
}


export interface CreateBookingInput {
  enrollmentId: string;
  windowId: string;
  date: Date;
  kind?: 'REGULAR' | 'MAKEUP';
  makeupForId?: string;
  // 點名現場加入的「硬開」：名額已滿仍可加入（老師/行政確認後）。
  // 只跳過容量檢查，其餘防呆（星期、停開日、同日重複、停用報名）照擋。
  allowOverCapacity?: boolean;
  // 學生自行預約時通知時段老師；行政代排、點名現場加入不通知。
  notifyStaff?: boolean;
}

// 預約不再選時段：一筆預約＝「這位學生這天會來」，booking 的 startTime/endTime
// 直接沿用窗口本身的時段（DB 欄位保留，kiosk 掃碼簽到等既有流程仍靠它排序
// 與顯示）。容量也因此簡化成當天人數上限：BOOKED＋PENDING_ADMIN 的既有預約
// 數達到 window.capacity 就滿了。
export async function createBooking(input: CreateBookingInput): Promise<{ id: string }> {
  const booking = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [window, enrollment] = await Promise.all([
          tx.tutoringWindow.findUnique({ where: { id: input.windowId } }),
          tx.tutoringEnrollment.findUnique({ where: { id: input.enrollmentId } }),
        ]);
        if (!window) throw new Error('WINDOW_NOT_FOUND');
        if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
        if (!enrollment.active) throw new Error('ENROLLMENT_INACTIVE');
        if (window.programId !== enrollment.programId) throw new Error('PROGRAM_MISMATCH');
        if (input.date.getUTCDay() !== window.weekday) throw new Error('INVALID_WEEKDAY');

        const closure = await tx.tutoringWindowClosure.findUnique({
          where: { windowId_date: { windowId: input.windowId, date: input.date } },
        });
        if (closure) throw new Error('WINDOW_CLOSED');

        // 一天一格：同一筆報名同一天已有有效預約（不論一般或補課）就不能再疊，
        // 否則額度條的「已預約」會多於日曆上看得到的「已約」天數
        const sameDay = await tx.tutoringBooking.count({
          where: { enrollmentId: input.enrollmentId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
        });
        if (sameDay > 0) throw new Error('ALREADY_BOOKED_SAME_DAY');

        if (!input.allowOverCapacity) {
          const booked = await tx.tutoringBooking.count({
            where: { windowId: input.windowId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
          });
          if (booked >= window.capacity) throw new Error('WINDOW_FULL');
        }

        return tx.tutoringBooking.create({
          data: {
            enrollmentId: input.enrollmentId,
            windowId: input.windowId,
            date: input.date,
            startTime: window.startTime,
            endTime: window.endTime,
            kind: input.kind ?? 'REGULAR',
            status: input.kind === 'MAKEUP' ? 'PENDING_ADMIN' : 'BOOKED',
            makeupForId: input.makeupForId,
          },
          select: { id: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  if (input.notifyStaff) await notifyStaffBookingChange(booking.id, 'BOOKED');
  return booking;
}

export interface WalkInCandidate {
  enrollmentId: string;
  studentId: string;
  studentName: string;
}

// 點名「現場加入」的候選名單：該時段課程的 active 報名，扣掉當天已有
// 有效預約的人（他們本來就在點名表上）。
export async function listWalkInCandidates(windowId: string, date: Date): Promise<WalkInCandidate[]> {
  const window = await prisma.tutoringWindow.findUnique({ where: { id: windowId }, select: { programId: true } });
  if (!window) throw new Error('WINDOW_NOT_FOUND');

  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: { programId: window.programId, active: true },
    select: {
      id: true,
      studentId: true,
      student: { select: { user: { select: { name: true } } } },
      bookings: {
        where: { date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
        select: { id: true },
      },
    },
    orderBy: { student: { user: { name: 'asc' } } },
  });

  return enrollments
    .filter((e) => e.bookings.length === 0)
    .map((e) => ({ enrollmentId: e.id, studentId: e.studentId, studentName: e.student.user.name }));
}

export async function cancelBooking(bookingId: string, studentId: string): Promise<void> {
  let booking;
  try {
    booking = await prisma.tutoringBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { enrollment: { select: { studentId: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('BOOKING_NOT_FOUND');
    }
    throw err;
  }
  if (booking.enrollment.studentId !== studentId) throw new Error('NOT_OWNER');

  // 收費規範：未到場不扣堂——取消一律不計次，保留紀錄（狀態 CANCELLED）
  // 讓學生的預約紀錄看得到這筆取消。
  await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
  await notifyStaffBookingChange(bookingId, 'CANCELLED');
}

// 行政取消：與學生取消同語意，一律不計次（收費規範沒有「計次取消」——
// 扣堂只看有無到場）。CANCELLED_LATE 僅存在於歷史資料，不再產生。
export async function adminCancelBooking(bookingId: string): Promise<void> {
  try {
    await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('BOOKING_NOT_FOUND');
    }
    throw err;
  }
}

// 學生自行預約／取消時通知該時段老師（含第二老師）。
// 失敗只記 log，不影響主流程。
async function notifyStaffBookingChange(bookingId: string, change: 'BOOKED' | 'CANCELLED') {
  try {
    const booking = await prisma.tutoringBooking.findUnique({
      where: { id: bookingId },
      select: {
        date: true,
        window: {
          select: {
            teacher: { select: { userId: true } },
            teacher2: { select: { userId: true } },
            program: { select: { name: true } },
          },
        },
        enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      },
    });
    if (!booking) return;
    const studentName = booking.enrollment.student.user.name;
    const dateLabel = formatDateWithWeekday(booking.date, 'zh-TW');
    const payload =
      change === 'BOOKED'
        ? { title: '個別輔導預約', body: `${studentName} 已預約 ${dateLabel}「${booking.window.program.name}」` }
        : { title: '個別輔導取消', body: `${studentName} 已取消 ${dateLabel}「${booking.window.program.name}」` };
    const teacherUserIds = [booking.window.teacher.userId, booking.window.teacher2?.userId].filter(
      (id): id is string => Boolean(id)
    );
    // 2026-08-20 使用者決定：行政只收「需要審核」的通知，預約異動即時生效
    // 不用審核，所以只通知該時段老師，不再 pushToAdmins。
    await pushToUsers(teacherUserIds, { ...payload, url: '/teacher' });
  } catch (err) {
    console.error('tutoring booking push notification failed', err);
  }
}

export async function getMonthlyQuotaStatus(
  enrollmentId: string,
  monthKey: string // 'YYYY-MM'
): Promise<{ locked: number; upcoming: number; quota: number }> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { program: { select: { defaultMonthlyQuota: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const todayKey = taipeiDateKey(new Date());

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR', date: { gte: monthStart, lte: monthEnd } },
    select: { date: true, status: true, attendance: { select: { status: true } } },
  });

  let locked = 0;
  let upcoming = 0;
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || b.status === 'CANCELLED_LATE') continue;
    // 收費規範：「有預約且到場上課才扣堂」——有出席紀錄（且非缺席）才計次。
    // 日期過了但沒到場、沒點名、缺席都不扣堂；當天（含）以後仍有效的預約
    // 顯示為「已預約」，過期未到的預約兩邊都不算。
    if (b.attendance && b.attendance.status !== 'ABSENT') locked++;
    else if (b.status === 'BOOKED' && utcDateKey(b.date) >= todayKey) upcoming++;
  }
  return { locked, upcoming, quota };
}

export interface AvailabilityDay {
  date: string;
  windowId: string;
  capacity: number;
  remaining: number;
  // 這筆報名自己在這一天的預約（日曆用不同色標示「已約」、點擊可取消）；
  // PENDING_ADMIN 是待核准的補課申請，只標示不開放按掉。myBookingCount 是
  // 同一天的有效預約筆數——防呆上線前的舊資料可能同一天疊多筆，要顯示 ×N
  myBookingId: string | null;
  myBookingStatus: 'BOOKED' | 'PENDING_ADMIN' | null;
  myBookingCount: number;
}

export async function listAvailability(enrollmentId: string, days = 14): Promise<AvailabilityDay[]> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const windows = await prisma.tutoringWindow.findMany({ where: { programId: enrollment.programId, active: true } });
  const todayKey = taipeiDateKey(new Date());
  const [ty, tm, td] = todayKey.split('-').map(Number);

  const myBookings = await prisma.tutoringBooking.findMany({
    where: {
      enrollmentId,
      status: { in: ['BOOKED', 'PENDING_ADMIN'] },
      date: { gte: new Date(Date.UTC(ty, tm - 1, td)), lte: new Date(Date.UTC(ty, tm - 1, td + days - 1)) },
    },
    select: { id: true, date: true, status: true },
  });
  const mineByDate = new Map<string, { id: string; status: 'BOOKED' | 'PENDING_ADMIN'; count: number }>();
  for (const b of myBookings) {
    const key = utcDateKey(b.date);
    const existing = mineByDate.get(key);
    // 同一天有多筆時優先顯示 BOOKED（可按掉的那筆），並累計筆數
    if (!existing) {
      mineByDate.set(key, { id: b.id, status: b.status as 'BOOKED' | 'PENDING_ADMIN', count: 1 });
    } else {
      if (existing.status !== 'BOOKED' && b.status === 'BOOKED') {
        existing.id = b.id;
        existing.status = 'BOOKED';
      }
      existing.count += 1;
    }
  }

  const result: AvailabilityDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(ty, tm - 1, td + i));
    const window = windows.find((w) => w.weekday === d.getUTCDay());
    if (!window) continue;

    const closure = await prisma.tutoringWindowClosure.findUnique({
      where: { windowId_date: { windowId: window.id, date: d } },
    });
    if (closure) continue;

    const booked = await prisma.tutoringBooking.count({
      where: { windowId: window.id, date: d, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
    });
    const mine = mineByDate.get(utcDateKey(d));
    result.push({
      date: utcDateKey(d),
      windowId: window.id,
      capacity: window.capacity,
      remaining: Math.max(0, window.capacity - booked),
      myBookingId: mine?.id ?? null,
      myBookingStatus: mine?.status ?? null,
      myBookingCount: mine?.count ?? 0,
    });
  }
  return result;
}

export interface StudentBookingRow {
  id: string;
  programName: string;
  date: Date;
  // MAKEUP／PENDING_ADMIN／CANCELLED_LATE／REJECTED 僅存在於歷史資料
  //（收費規範已無補課概念），保留型別讓舊紀錄能正常顯示。
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function listBookingsForStudent(studentId: string): Promise<StudentBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollment: { studentId } },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      window: { select: { program: { select: { name: true } } } },
      attendance: { select: { status: true, checkInTime: true, checkOutTime: true } },
    },
    orderBy: { date: 'desc' },
  });
  return bookings.map((b) => ({
    id: b.id,
    programName: b.window.program.name,
    date: b.date,
    kind: b.kind as 'REGULAR' | 'MAKEUP',
    status: b.status as StudentBookingRow['status'],
    attendanceStatus: (b.attendance?.status as StudentBookingRow['attendanceStatus']) ?? null,
    checkInTime: b.attendance?.checkInTime ?? null,
    checkOutTime: b.attendance?.checkOutTime ?? null,
  }));
}

export interface TutoringLedgerRow {
  id: string;
  date: Date;
  kind: 'GRANT' | 'DEDUCT';
  amount: number; // GRANT: +monthlyQuota；DEDUCT: -1
  status: 'BOOKED' | 'CANCELLED_LATE' | null; // GRANT 沒有對應的預約，是 null
  checkInTime: string | null;
  remainingAfter: number;
}

// 學生自己看的個別輔導「扣堂紀錄」：跟班級／弈廳一樣是一份完整的堂數增減
// 帳本——每個月月初核發當月額度（GRANT，+monthlyQuota）算一筆「建立」，之後
// 每一堂真的扣掉名額的預約（收費規範：有預約且到場才扣堂——有出席紀錄且
// 非缺席，判斷邏輯跟 getMonthlyQuotaStatus 一致）算一筆 DEDUCT（-1）。
// 未到場、未點名、取消的預約都不是增減事件，不放進帳本——那些屬於「我的
// 預約紀錄」。月額度按月重置，跟班級／弈廳的終身堂數池不同，所以要照預約
// 日期所在月份分組，各自從當月額度倒推，不能跨月累加。
export async function getTutoringDeductionLedger(
  enrollmentId: string
): Promise<{ monthlyQuota: number; history: TutoringLedgerRow[] }> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { program: { select: { defaultMonthlyQuota: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      attendance: { select: { status: true, checkInTime: true } },
    },
    orderBy: { date: 'desc' },
  });

  const monthGroups = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const monthKey = utcDateKey(b.date).slice(0, 7);
    if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, []);
    monthGroups.get(monthKey)!.push(b);
  }

  const history: TutoringLedgerRow[] = [];
  for (const [monthKey, rows] of Array.from(monthGroups.entries())) {
    // 有出席紀錄（非缺席）才扣堂——判斷邏輯跟 getMonthlyQuotaStatus 一致
    const isCounted = (b: (typeof rows)[number]) =>
      b.kind === 'REGULAR' &&
      b.status !== 'CANCELLED' &&
      b.status !== 'CANCELLED_LATE' &&
      b.attendance != null &&
      b.attendance.status !== 'ABSENT';
    const countedInMonth = rows.filter(isCounted).length;
    let runningAfter = quota - countedInMonth;
    for (const b of rows) {
      const counted = isCounted(b);
      const remainingAfter = runningAfter;
      if (counted) runningAfter += 1;
      if (!counted) continue;
      history.push({
        id: b.id,
        date: b.date,
        kind: 'DEDUCT',
        amount: -1,
        status: b.status as TutoringLedgerRow['status'],
        checkInTime: b.attendance?.checkInTime ?? null,
        remainingAfter,
      });
    }
    // 處理完這個月所有扣堂後 runningAfter 會加回到 quota 本身——那就是這個月
    // 核發當下（尚未扣任何一堂）的剩餘堂數。
    history.push({
      id: `grant-${monthKey}`,
      date: new Date(`${monthKey}-01T00:00:00.000Z`),
      kind: 'GRANT',
      amount: quota,
      status: null,
      checkInTime: null,
      remainingAfter: runningAfter,
    });
  }

  return { monthlyQuota: quota, history };
}

export interface OverviewBookingRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: Date;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
}

export async function listBookingsOverview(date: Date): Promise<OverviewBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { date },
    select: {
      id: true,
      kind: true,
      status: true,
      date: true,
      windowId: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
    },
  });
  return bookings
    .map((b) => ({
      id: b.id,
      studentName: b.enrollment.student.user.name,
      programName: b.window.program.name,
      windowId: b.windowId,
      date: b.date,
      kind: b.kind as 'REGULAR' | 'MAKEUP',
      status: b.status as OverviewBookingRow['status'],
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export interface DailyBookingCount {
  date: string; // YYYY-MM-DD
  booked: number;
  pending: number;
}

// 月曆總覽用：整月每天的預約人數，一次 groupBy 撈完（不逐日查詢）。
// booked＝已確定會來的人數；pending＝待核准的補課申請（也佔容量，分開顯示）。
export async function listMonthlyBookingCounts(monthKey: string): Promise<DailyBookingCount[]> {
  const [year, month] = monthKey.split('-').map(Number);
  const groups = await prisma.tutoringBooking.groupBy({
    by: ['date', 'status'],
    where: {
      date: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) },
      status: { in: ['BOOKED', 'PENDING_ADMIN'] },
    },
    _count: { _all: true },
  });
  const byDate = new Map<string, DailyBookingCount>();
  for (const g of groups) {
    const key = utcDateKey(g.date);
    const row = byDate.get(key) ?? { date: key, booked: 0, pending: 0 };
    if (g.status === 'BOOKED') row.booked += g._count._all;
    else row.pending += g._count._all;
    byDate.set(key, row);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function sendMonthlyQuotaReminders(): Promise<{ notified: number }> {
  const monthKey = taipeiDateKey(new Date()).slice(0, 7);
  const enrollments = await prisma.tutoringEnrollment.findMany({
    // `lastQuotaReminderMonth: { not: monthKey }` alone would silently drop
    // enrollments where the field is still null (SQL's NULL <> x is unknown,
    // so Prisma excludes it) — the common case for an enrollment that has
    // never been reminded. OR in the null case explicitly.
    where: {
      active: true,
      OR: [{ lastQuotaReminderMonth: null }, { lastQuotaReminderMonth: { not: monthKey } }],
    },
    include: {
      program: { select: { name: true } },
      student: { select: { id: true, user: { select: { id: true, name: true } } } },
    },
  });

  let notified = 0;
  for (const e of enrollments) {
    if (!(await hasPushSubscription(e.student.user.id))) continue;
    const { locked, upcoming, quota } = await getMonthlyQuotaStatus(e.id, monthKey);
    if (locked + upcoming >= quota) continue;
    await pushToUser(e.student.user.id, {
      title: '個別輔導額度提醒',
      body: `${e.student.user.name} 本月「${e.program.name}」還剩 ${quota - locked - upcoming} 堂未預約，記得安排上課時間`,
      url: '/student/tutoring',
    });
    await prisma.tutoringEnrollment.update({ where: { id: e.id }, data: { lastQuotaReminderMonth: monthKey } });
    notified++;
  }
  return { notified };
}

export interface MonthlySummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  absent: number;
}

// 已上／當天取消／缺席／補課 統計，供行政對帳與 CSV 匯出。「已上」= 已鎖定且非取消非缺席的
// REGULAR 預約（含尚未點名的，視為已上——月結報表以「有沒有到場義務」為準，不是點名進度表）。
export async function listMonthlyAttendanceSummary(monthKey: string): Promise<MonthlySummaryRow[]> {
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const bookings = await prisma.tutoringBooking.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
    select: {
      date: true,
      kind: true,
      status: true,
      enrollment: { select: { id: true, student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
      attendance: { select: { status: true } },
    },
  });

  const byEnrollmentId = new Map<string, MonthlySummaryRow>();
  for (const b of bookings) {
    const key = b.enrollment.id;
    if (!byEnrollmentId.has(key)) {
      byEnrollmentId.set(key, {
        enrollmentId: key,
        studentName: b.enrollment.student.user.name,
        programName: b.window.program.name,
        attended: 0,
        absent: 0,
      });
    }
    // 收費規範：只看出席紀錄——有點名且非缺席算「已上」，點了缺席算「缺席」
    //（不扣堂，純供出席參考）；沒點名、取消的預約不列入統計。
    const row = byEnrollmentId.get(key)!;
    if (!b.attendance) continue;
    if (b.attendance.status === 'ABSENT') row.absent++;
    else row.attended++;
  }
  return Array.from(byEnrollmentId.values()).sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}
