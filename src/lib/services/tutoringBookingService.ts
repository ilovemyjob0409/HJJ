import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { notifyUser, notifyUsers, notifyAdmins } from './notificationService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { taipeiDateKey } from '@/lib/taipeiDate';

// 重新匯出：許多檔案已經是用 `import { taipeiDateKey } from
// '@/lib/services/tutoringBookingService'`，保留這個路徑可用，實作則搬到
// 零依賴的 @/lib/taipeiDate（見該檔註解：pastDate.ts 等純模組需要它，不能
// 牽動這支檔案的 db/prisma/web-push 依賴鏈）。
export { taipeiDateKey };

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  // 學生自行預約時啟用「每月額度審核」：本月已計次＋有效預約已達額度時，
  // 這筆改建成 PENDING_ADMIN 送行政審核（不擋，行政人工判斷）。
  // 行政代排、點名現場加入不啟用，超額照樣直接成立。
  quotaReview?: boolean;
}

// 預約不再選時段：一筆預約＝「這位學生這天會來」，booking 的 startTime/endTime
// 直接沿用窗口本身的時段（DB 欄位保留，kiosk 掃碼簽到等既有流程仍靠它排序
// 與顯示）。容量也因此簡化成當天人數上限：BOOKED＋PENDING_ADMIN 的既有預約
// 數達到 window.capacity 就滿了。
export async function createBooking(input: CreateBookingInput): Promise<{ id: string; status: 'BOOKED' | 'PENDING_ADMIN' }> {
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

        // 每月額度閘門（學生自行預約才啟用）：以預約日期所屬月份計，
        // 「已計次＋今天（台北）起的有效預約（BOOKED＋待審）」達到額度時，
        // 這筆改建成 PENDING_ADMIN 送行政審核。計數直接重用
        // getMonthlyQuotaStatus（傳入 tx 在同一個 Serializable transaction 內
        // 查詢），額度口徑永遠與學生端額度條一致；放在 transaction 內，
        // 並發送出多筆時不會同時以「第 quota 堂」的身分通過。
        let needsReview = false;
        if (input.quotaReview && input.kind !== 'MAKEUP') {
          const { locked, upcoming, quota, pendingOverQuota } = await getMonthlyQuotaStatus(
            input.enrollmentId,
            utcDateKey(input.date).slice(0, 7),
            tx
          );
          needsReview = locked + upcoming + pendingOverQuota >= quota;
        }

        return tx.tutoringBooking.create({
          data: {
            enrollmentId: input.enrollmentId,
            windowId: input.windowId,
            date: input.date,
            startTime: window.startTime,
            endTime: window.endTime,
            kind: input.kind ?? 'REGULAR',
            status: input.kind === 'MAKEUP' || needsReview ? 'PENDING_ADMIN' : 'BOOKED',
            makeupForId: input.makeupForId,
          },
          select: { id: true, status: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  if (booking.status === 'PENDING_ADMIN' && input.quotaReview) await notifyAdminsReviewNeeded(booking.id);
  // 老師只收「確定成立」的預約通知：超額待審在核准前不會出現在點名名單，
  // 建立當下不通知老師，核准時（reviewBooking）才補發。
  if (input.notifyStaff && booking.status === 'BOOKED') await notifyStaffBookingChange(booking.id, 'BOOKED');
  return { id: booking.id, status: booking.status as 'BOOKED' | 'PENDING_ADMIN' };
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
  // 老師只收過「確定成立」的預約通知——取消「待審中」的預約不用通知老師
  //（他從未被告知這筆預約存在）。
  if (booking.status === 'BOOKED') await notifyStaffBookingChange(bookingId, 'CANCELLED');
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

// 行政審核超額預約：核准 → BOOKED、駁回 → REJECTED。用條件式 updateMany
// 避免重複審核的競態（只有 PENDING_ADMIN 能轉出），結果推播通知學生。
async function reviewBooking(bookingId: string, to: 'BOOKED' | 'REJECTED'): Promise<void> {
  const result = await prisma.tutoringBooking.updateMany({
    where: { id: bookingId, status: 'PENDING_ADMIN' },
    data: { status: to },
  });
  if (result.count === 0) {
    const exists = await prisma.tutoringBooking.findUnique({ where: { id: bookingId }, select: { id: true } });
    throw new Error(exists ? 'NOT_PENDING' : 'BOOKING_NOT_FOUND');
  }
  await notifyStudentReviewResult(bookingId, to);
  // 核准後預約正式成立、會出現在點名名單，這時才通知時段老師（駁回不通知，
  // 與行政取消的慣例一致）。
  if (to === 'BOOKED') await notifyStaffBookingChange(bookingId, 'BOOKED');
}

export function approveBooking(bookingId: string): Promise<void> {
  return reviewBooking(bookingId, 'BOOKED');
}

export function rejectBooking(bookingId: string): Promise<void> {
  return reviewBooking(bookingId, 'REJECTED');
}

// 審核結果通知學生。失敗只記 log，不影響主流程。
async function notifyStudentReviewResult(bookingId: string, to: 'BOOKED' | 'REJECTED') {
  try {
    const booking = await prisma.tutoringBooking.findUnique({
      where: { id: bookingId },
      select: {
        date: true,
        window: { select: { program: { select: { name: true } } } },
        enrollment: { select: { student: { select: { user: { select: { id: true } } } } } },
      },
    });
    if (!booking) return;
    const dateLabel = formatDateWithWeekday(booking.date, 'zh-TW');
    const payload =
      to === 'BOOKED'
        ? { title: '超額預約已核准', body: `${dateLabel}「${booking.window.program.name}」的預約已核准` }
        : {
            title: '超額預約未核准',
            body: `${dateLabel}「${booking.window.program.name}」的預約未核准，這筆預約不成立，若有疑問請與班主任聯繫`,
          };
    await notifyUser(booking.enrollment.student.user.id, { ...payload, url: '/student/tutoring' });
  } catch (err) {
    console.error('tutoring review result push failed', err);
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
    // 不用審核，所以只通知該時段老師，不再通知行政。
    await notifyUsers(teacherUserIds, { ...payload, url: '/teacher' });
  } catch (err) {
    console.error('tutoring booking push notification failed', err);
  }
}

// 超額預約送審成立時推播行政（2026-08-20 慣例：行政只收「需要審核」的
// 通知）。失敗只記 log，不影響主流程。
async function notifyAdminsReviewNeeded(bookingId: string) {
  try {
    const booking = await prisma.tutoringBooking.findUnique({
      where: { id: bookingId },
      select: {
        date: true,
        window: { select: { program: { select: { name: true } } } },
        enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      },
    });
    if (!booking) return;
    await notifyAdmins({
      title: '個別輔導超額預約審核',
      body: `${booking.enrollment.student.user.name} 預約 ${formatDateWithWeekday(booking.date, 'zh-TW')}「${booking.window.program.name}」已超過本月額度，請至系統審核`,
      url: '/admin/tutoring/bookings',
    });
  } catch (err) {
    console.error('tutoring over-quota review push failed', err);
  }
}

export interface QuotaBuckets {
  locked: number;
  upcoming: number;
  pendingOverQuota: number;
}

// 額度分類的唯一事實來源：getMonthlyQuotaStatus 與 listEnrollments 的批次
// 路徑共用（口徑分家就會重演超額審核前「顯示與閘門不一致」的問題）。
// 收費規範：「有預約且到場上課才扣堂」——有出席紀錄（且非缺席）才計次。
// 日期過了但沒到場、沒點名、缺席都不扣堂；當天（含）以後仍有效的預約
// 顯示為「已預約」，過期未到的預約兩邊都不算。超過額度送審中的
// PENDING_ADMIN 另計（pendingOverQuota），不佔「剩餘可約」。
export function classifyQuotaBookings(
  bookings: { date: Date; status: string; attendance: { status: string } | null }[],
  todayKey: string
): QuotaBuckets {
  let locked = 0;
  let upcoming = 0;
  let pendingOverQuota = 0;
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || b.status === 'CANCELLED_LATE') continue;
    if (b.attendance && b.attendance.status !== 'ABSENT') locked++;
    else if (b.status === 'BOOKED' && utcDateKey(b.date) >= todayKey) upcoming++;
    else if (b.status === 'PENDING_ADMIN' && utcDateKey(b.date) >= todayKey) pendingOverQuota++;
  }
  return { locked, upcoming, pendingOverQuota };
}

export async function getMonthlyQuotaStatus(
  enrollmentId: string,
  monthKey: string, // 'YYYY-MM'
  db: Prisma.TransactionClient = prisma
): Promise<{ locked: number; upcoming: number; quota: number; pendingOverQuota: number }> {
  const enrollment = await db.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { program: { select: { defaultMonthlyQuota: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const todayKey = taipeiDateKey(new Date());

  const bookings = await db.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR', date: { gte: monthStart, lte: monthEnd } },
    select: { date: true, status: true, attendance: { select: { status: true } } },
  });

  const { locked, upcoming, pendingOverQuota } = classifyQuotaBookings(bookings, todayKey);
  return { locked, upcoming, quota, pendingOverQuota };
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

// 學生端「我的出缺勤紀錄」：取列條件同行政端 getTutoringEnrollmentAttendance
// ——有點名紀錄的 booking＋「未到課」（過期、未取消、未點名；今天的還不算），
// 跨該學生全部報名。未來預約看日曆的「已約」，未點名的取消不列。
export async function listAttendanceForStudent(studentId: string, now: Date = new Date()): Promise<StudentBookingRow[]> {
  const [ty, tm, td] = taipeiDateKey(now).split('-').map(Number);
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td));

  const bookings = await prisma.tutoringBooking.findMany({
    where: {
      enrollment: { studentId },
      OR: [
        { attendance: { isNot: null } },
        { status: 'BOOKED', attendance: null, date: { lt: todayUtc } },
      ],
    },
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

function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface PendingReviewRow {
  id: string;
  enrollmentId: string;
  studentName: string;
  programName: string;
  date: Date;
  seq: number; // 核准後是當月第幾堂（已計次＋已約＋前面的待審筆數＋1）
  quota: number;
  // 近 3 個月（預約當月、上月、前月）已計次堂數，供行政人工判斷是否真有未補的課
  monthUsage: { monthKey: string; attended: number }[];
}

// 行政待審佇列：今天（台北）起、狀態 PENDING_ADMIN 的預約，依送出時間排序。
// 已過期的待審（含舊制補課遺留資料）不列——到場與否已由點名決定，事後審核
// 無意義。統計以「預約日期所屬月份」為準（目前預約範圍只開放當月，兩者相同）。
export async function listPendingReviewBookings(now: Date = new Date()): Promise<PendingReviewRow[]> {
  const [ty, tm, td] = taipeiDateKey(now).split('-').map(Number);
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td));

  const pending = await prisma.tutoringBooking.findMany({
    where: { status: 'PENDING_ADMIN', date: { gte: todayUtc } },
    select: {
      id: true,
      enrollmentId: true,
      date: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // 同一報名同一月份的統計只查一次；seen 累計先送審的筆數，讓 seq 依序遞增
  const statsCache = new Map<
    string,
    { locked: number; upcoming: number; quota: number; monthUsage: { monthKey: string; attended: number }[]; seen: number }
  >();
  const rows: PendingReviewRow[] = [];
  for (const b of pending) {
    const monthKey = utcDateKey(b.date).slice(0, 7);
    const cacheKey = `${b.enrollmentId}:${monthKey}`;
    let stats = statsCache.get(cacheKey);
    if (!stats) {
      const { locked, upcoming, quota } = await getMonthlyQuotaStatus(b.enrollmentId, monthKey);
      const monthUsage = [{ monthKey, attended: locked }];
      for (let k = 1; k < 3; k++) {
        const mk = shiftMonthKey(monthKey, -k);
        monthUsage.push({ monthKey: mk, attended: (await getMonthlyQuotaStatus(b.enrollmentId, mk)).locked });
      }
      stats = { locked, upcoming, quota, monthUsage, seen: 0 };
      statsCache.set(cacheKey, stats);
    }
    stats.seen += 1;
    rows.push({
      id: b.id,
      enrollmentId: b.enrollmentId,
      studentName: b.enrollment.student.user.name,
      programName: b.window.program.name,
      date: b.date,
      seq: stats.locked + stats.upcoming + stats.seen,
      quota: stats.quota,
      monthUsage: stats.monthUsage,
    });
  }
  return rows;
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

  // 收件夾讓沒訂閱推播的人也收得到，不再以訂閱與否決定要不要發（旗標照燒）
  let notified = 0;
  for (const e of enrollments) {
    const { locked, upcoming, quota, pendingOverQuota } = await getMonthlyQuotaStatus(e.id, monthKey);
    if (locked + upcoming + pendingOverQuota >= quota) continue;
    await notifyUser(e.student.user.id, {
      title: '個別輔導額度提醒',
      body: `${e.student.user.name} 本月「${e.program.name}」還剩 ${quota - locked - upcoming} 堂未預約，記得安排上課時間`,
      url: '/student/tutoring',
    });
    await prisma.tutoringEnrollment.update({ where: { id: e.id }, data: { lastQuotaReminderMonth: monthKey } });
    notified++;
  }
  return { notified };
}

// 「未取消未到不扣堂，系統主動通知家長改約」——每天早上檢查昨天完全沒被
// 點名（含未取消）的預約，推播提醒。只看 status:'BOOKED' 且沒有出席紀錄
// 的：已取消的不用管（家長已經知道），已點名的（不論出席與否）代表現場
// 已經處理過，不重複打擾。now 可注入方便測試，cron 呼叫時用預設的「現在」。
export async function sendMissedSessionReminders(now: Date = new Date()): Promise<{ notified: number }> {
  const todayKey = taipeiDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1));

  const bookings = await prisma.tutoringBooking.findMany({
    where: { status: 'BOOKED', date: yesterday, attendance: null },
    select: {
      window: { select: { program: { select: { name: true } } } },
      enrollment: { select: { student: { select: { user: { select: { id: true, name: true } } } } } },
    },
  });

  let notified = 0;
  for (const b of bookings) {
    const userId = b.enrollment.student.user.id;
    await notifyUser(userId, {
      title: '缺席提醒',
      body: `${b.enrollment.student.user.name} 昨日「${b.window.program.name}」未到課，請至系統重新預約新的上課日期`,
      url: '/student/tutoring',
    });
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
