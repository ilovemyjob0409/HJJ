import { prisma } from '@/lib/db';
import { listClosedDays } from './closedDayService';
import { computeClassSessionDates, utcKey } from '@/lib/billingCalc';
import { taipeiDateKey } from '@/lib/taipeiDate';

// 開單時的「上期剩餘」要先扣掉：今天（台北）到收費區間前一天之間，還排著、
// 尚未點名的本班上課日——那幾堂學生照常會來上、會扣堂，不能再拿去折抵下一期，
// 否則同一堂既折抵又上課，算了兩次（期末剩餘會變負）。停課日、已請假（請假不扣
// 堂，那堂本來就該留著折抵）、已點名（不論狀態，已反映在已扣堂數）的日子不算。
// 回傳 key 為 `${studentId}:${classId}`，值為日期（'YYYY-MM-DD'，舊→新）；沒有
// 尚未上的課的組合不會出現在 Map 裡。收費區間已開始（起日 ≤ 今天）時一律為空。
// 已知限制：開單當下預測不到的變化——開單後才撤銷請假、或過去漏點名事後才補登——
// 仍可能讓同一堂既折抵又扣堂，需行政在帳單上手動調整。
export async function getUpcomingSessionKeys(
  pairs: { studentId: string; classId: string; weekday: number }[],
  periodStart: Date,
  now: Date = new Date()
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const todayUtc = new Date(`${taipeiDateKey(now)}T00:00:00Z`);
  if (pairs.length === 0 || todayUtc.getTime() >= periodStart.getTime()) return result;
  const lastDay = new Date(periodStart.getTime() - 86_400_000);
  const studentIds = Array.from(new Set(pairs.map((p) => p.studentId)));
  const classIds = Array.from(new Set(pairs.map((p) => p.classId)));

  const [closedDays, attendances, leaves] = await Promise.all([
    listClosedDays(todayUtc, lastDay),
    prisma.classAttendance.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds }, date: { gte: todayUtc, lte: lastDay } },
      select: { studentId: true, classId: true, date: true },
    }),
    prisma.leaveRequest.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds }, date: { gte: todayUtc, lte: lastDay } },
      select: { studentId: true, classId: true, date: true },
    }),
  ]);
  const settled = new Set([...attendances, ...leaves].map((r) => `${r.studentId}:${r.classId}:${utcKey(r.date)}`));

  for (const p of pairs) {
    const key = `${p.studentId}:${p.classId}`;
    const dates = computeClassSessionDates(p.weekday, todayUtc, lastDay, closedDays)
      .filter((e) => !e.closed && !settled.has(`${key}:${e.dateKey}`))
      .map((e) => e.dateKey);
    if (dates.length > 0) result.set(key, dates);
  }
  return result;
}
