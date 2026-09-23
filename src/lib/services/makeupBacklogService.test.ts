import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { backlogKey, computeTutoringBacklog, getClassMakeupBacklogs } from './makeupBacklogService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
// 台北 2026-09-23 中午（UTC 04:00）
const NOW = new Date(Date.UTC(2026, 8, 23, 4, 0));

async function setup() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const teacher = await createTeacher({ name: '陳老師', email: `mb-t-${stamp}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `mb-s-${stamp}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00' });
  await enrollStudent(cls.id, student.id);
  const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
  // 本期從 2026-09-01 起算（清掉 enrollStudent 可能建立的期別，固定起算日）
  await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId: enrollment.id } });
  await prisma.enrollmentPeriod.create({ data: { enrollmentId: enrollment.id, sessions: 12, createdAt: new Date(Date.UTC(2026, 8, 1, 2, 0)) } });
  const markerId = (await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } })).userId;
  return { teacher, student, cls, markerId };
}

async function leave(studentId: string, classId: string, date: Date, makeupStatus?: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED') {
  const l = await prisma.leaveRequest.create({ data: { studentId, classId, date, reason: '生病' } });
  if (makeupStatus) {
    await prisma.makeupRequest.create({
      data: { leaveRequestId: l.id, type: 'INSERTION', status: makeupStatus, targetClassId: classId, targetDate: D(2026, 10, 3) },
    });
  }
}

async function attend(studentId: string, classId: string, date: Date, status: 'PRESENT' | 'ABSENT' | 'ON_LEAVE', markedById: string) {
  await prisma.classAttendance.create({ data: { studentId, classId, date, status, markedById } });
}

describe('getClassMakeupBacklogs', () => {
  it('請假（無補課／被駁回／待審）與缺席都算，已核准補課與請假後出席不算', async () => {
    const { student, cls, markerId } = await setup();
    await leave(student.id, cls.id, D(2026, 9, 5)); // 無補課 → 算
    await leave(student.id, cls.id, D(2026, 9, 12), 'REJECTED'); // 駁回 → 算
    await leave(student.id, cls.id, D(2026, 9, 19), 'PENDING_ADMIN'); // 待審 → 算（makeupPending）
    await leave(student.id, cls.id, D(2026, 9, 6), 'APPROVED'); // 已核准 → 不算
    await attend(student.id, cls.id, D(2026, 9, 13), 'ABSENT', markerId); // 缺席 → 算
    await leave(student.id, cls.id, D(2026, 9, 20)); // 請假但後來出席 → 不算
    await attend(student.id, cls.id, D(2026, 9, 20), 'PRESENT', markerId);

    const map = await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW);
    const b = map.get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(4);
    expect(b.items).toEqual([
      { date: '2026-09-19', reason: 'LEAVE', makeupPending: true },
      { date: '2026-09-13', reason: 'ABSENT', makeupPending: false },
      { date: '2026-09-12', reason: 'LEAVE', makeupPending: false },
      { date: '2026-09-05', reason: 'LEAVE', makeupPending: false },
    ]);
  });

  it('同一天請假＋缺席只算一次（原因記缺席）；已核准補課的請假即使點了缺席也不算', async () => {
    const { student, cls, markerId } = await setup();
    await leave(student.id, cls.id, D(2026, 9, 5));
    await attend(student.id, cls.id, D(2026, 9, 5), 'ABSENT', markerId);
    await leave(student.id, cls.id, D(2026, 9, 12), 'APPROVED');
    await attend(student.id, cls.id, D(2026, 9, 12), 'ABSENT', markerId);

    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(1);
    expect(b.items).toEqual([{ date: '2026-09-05', reason: 'ABSENT', makeupPending: false }]);
  });

  it('本期起算日之前、今天之後都不算', async () => {
    const { student, cls, markerId } = await setup();
    await leave(student.id, cls.id, D(2026, 8, 29)); // 期別前
    await attend(student.id, cls.id, D(2026, 8, 22), 'ABSENT', markerId); // 期別前
    await leave(student.id, cls.id, D(2026, 9, 26)); // 未來
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b).toEqual({ count: 0, items: [] });
  });

  it('插班補課寫進本班的點名紀錄（帶 makeupRequestId）不算', async () => {
    const { student, cls, markerId } = await setup();
    const l = await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 8, 1), reason: 'x' } });
    const m = await prisma.makeupRequest.create({ data: { leaveRequestId: l.id, type: 'INSERTION', status: 'APPROVED', targetClassId: cls.id, targetDate: D(2026, 9, 5) } });
    await prisma.classAttendance.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 9, 5), status: 'ABSENT', markedById: markerId, makeupRequestId: m.id } });
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(0);
  });

  it('點名直接標 ON_LEAVE、沒有另外建請假單，也算未補', async () => {
    const { student, cls, markerId } = await setup();
    await attend(student.id, cls.id, D(2026, 9, 5), 'ON_LEAVE', markerId);
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(1);
    expect(b.items).toEqual([{ date: '2026-09-05', reason: 'LEAVE', makeupPending: false }]);
  });

  it('沒有期別紀錄時不設下限；空 pairs 回空 Map', async () => {
    const { student, cls, markerId } = await setup();
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId: enrollment.id } });
    await attend(student.id, cls.id, D(2026, 3, 7), 'ABSENT', markerId);
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(1);
    expect((await getClassMakeupBacklogs([], NOW)).size).toBe(0);
  });
});

describe('computeTutoringBacklog', () => {
  const bk = (d: string, status: string, att: string | null) => ({
    date: new Date(`${d}T00:00:00Z`),
    status,
    attendance: att ? { status: att } : null,
  });

  it('沒點名與點缺席都算缺席；今天與未來不算；取消不算', () => {
    const r = computeTutoringBacklog(
      [
        bk('2026-09-02', 'BOOKED', null), // 缺席（沒點名）
        bk('2026-09-09', 'BOOKED', 'ABSENT'), // 缺席
        bk('2026-09-16', 'BOOKED', 'PRESENT'), // 已上
        bk('2026-09-10', 'CANCELLED', null), // 取消
        bk('2026-09-23', 'BOOKED', null), // 今天 → upcoming
      ],
      8,
      '2026-09-23'
    );
    // 還能約 = 8 − 已上1 − 已約1 = 6 → 未補 = min(2, 6) = 2
    expect(r).toEqual({ count: 2, absentCount: 2, rebooked: 0, absentDates: ['2026-09-09', '2026-09-02'] });
  });

  it('另約補課後未補減少；額度用完時為 0', () => {
    const r = computeTutoringBacklog(
      [
        bk('2026-09-02', 'BOOKED', null),
        bk('2026-09-09', 'BOOKED', 'ABSENT'),
        bk('2026-09-16', 'BOOKED', 'PRESENT'),
        bk('2026-09-25', 'BOOKED', null),
        bk('2026-09-26', 'BOOKED', null),
      ],
      4,
      '2026-09-23'
    );
    // 還能約 = 4 − 1 − 2 = 1 → 未補 1、已另約 1
    expect(r.count).toBe(1);
    expect(r.rebooked).toBe(1);
    const full = computeTutoringBacklog([bk('2026-09-02', 'BOOKED', null), bk('2026-09-25', 'BOOKED', null)], 1, '2026-09-23');
    expect(full.count).toBe(0);
    expect(full.rebooked).toBe(1);
  });
});
