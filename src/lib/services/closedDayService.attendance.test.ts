import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { saveClassAttendance, getClassRoster } from './attendanceService';
import { addClosedDay, markGoClassAttendanceNotRegistered, markGoClassAttendanceNotRegisteredOnAllClosedDays, seedNationalHolidays } from './closedDayService';

const HOLIDAY = new Date(Date.UTC(2026, 9, 10)); // 種子內的國慶日
const NORMAL_DAY = new Date(Date.UTC(2026, 9, 7));

async function setup() {
  await prisma.user.create({ data: { id: 'marker-1', email: 'marker@example.com', password: 'x', name: 'Marker', role: 'TEACHER' } });
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋,英文' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const go = await createClass({ name: '圍棋班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '14:00', endTime: '16:00' });
  const en = await createClass({ name: '英文班', subject: '英文', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00' });
  await enrollStudent(go.id, student.id);
  await enrollStudent(en.id, student.id);
  return { student, go, en };
}

async function statusOf(classId: string, studentId: string, date: Date) {
  return (await prisma.classAttendance.findUnique({ where: { classId_studentId_date: { classId, studentId, date } } }))?.status;
}

describe('closed day → Go class attendance becomes NOT_REGISTERED', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
    const rec = (status: 'PRESENT' | 'ABSENT') => ({ studentId: ctx.student.id, status, checkInTime: null, checkOutTime: null, makeupRequestId: undefined });
    for (const d of [HOLIDAY, NORMAL_DAY]) {
      await saveClassAttendance(ctx.go.id, d, 'marker-1', [rec('PRESENT')]);
      await saveClassAttendance(ctx.en.id, d, 'marker-1', [rec('PRESENT')]);
    }
  });

  it('only changes Go classes on the given dates', async () => {
    const n = await markGoClassAttendanceNotRegistered([HOLIDAY]);
    expect(n).toBe(1);
    expect(await statusOf(ctx.go.id, ctx.student.id, HOLIDAY)).toBe('NOT_REGISTERED');
    expect(await statusOf(ctx.go.id, ctx.student.id, NORMAL_DAY)).toBe('PRESENT');
    expect(await statusOf(ctx.en.id, ctx.student.id, HOLIDAY)).toBe('PRESENT');
    expect(await markGoClassAttendanceNotRegistered([HOLIDAY])).toBe(0); // 冪等
  });

  it('applies when a custom closed day is added', async () => {
    await addClosedDay(NORMAL_DAY, '颱風停課');
    expect(await statusOf(ctx.go.id, ctx.student.id, NORMAL_DAY)).toBe('NOT_REGISTERED');
    expect(await statusOf(ctx.en.id, ctx.student.id, NORMAL_DAY)).toBe('PRESENT');
  });

  it('applies when national holidays are seeded', async () => {
    await seedNationalHolidays();
    expect(await statusOf(ctx.go.id, ctx.student.id, HOLIDAY)).toBe('NOT_REGISTERED');
    expect(await statusOf(ctx.go.id, ctx.student.id, NORMAL_DAY)).toBe('PRESENT');
  });

  it('forces NOT_REGISTERED when saving Go attendance on an existing closed day', async () => {
    await prisma.closedDay.create({ data: { date: NORMAL_DAY, name: '休假', source: 'CUSTOM' } });
    const rec = { studentId: ctx.student.id, status: 'PRESENT' as const, checkInTime: '14:00', checkOutTime: null, makeupRequestId: undefined };
    await saveClassAttendance(ctx.go.id, NORMAL_DAY, 'marker-1', [rec]);
    await saveClassAttendance(ctx.en.id, NORMAL_DAY, 'marker-1', [rec]);
    expect(await statusOf(ctx.go.id, ctx.student.id, NORMAL_DAY)).toBe('NOT_REGISTERED');
    expect(await statusOf(ctx.en.id, ctx.student.id, NORMAL_DAY)).toBe('PRESENT');
  });

  it('daily sweep catches attendance written after the closed day was added', async () => {
    await prisma.closedDay.create({ data: { date: NORMAL_DAY, name: '休假', source: 'CUSTOM' } });
    // 直接寫入模擬不經 saveClassAttendance 的路徑（如掃碼簽到）；beforeEach 已有 PRESENT 的點名
    expect(await markGoClassAttendanceNotRegisteredOnAllClosedDays()).toBe(1);
    expect(await statusOf(ctx.go.id, ctx.student.id, NORMAL_DAY)).toBe('NOT_REGISTERED');
  });

  it('roster shows NOT_REGISTERED for Go students without a record on a closed day', async () => {
    const future = new Date(Date.UTC(2026, 9, 25));
    await prisma.closedDay.upsert({ where: { date: future }, update: {}, create: { date: future, name: '光復節', source: 'NATIONAL' } });
    const go = await getClassRoster(ctx.go.id, future);
    const en = await getClassRoster(ctx.en.id, future);
    expect(go.map((r) => r.status)).toEqual(['NOT_REGISTERED']);
    expect(en.map((r) => r.status)).toEqual([null]);
    const normal = await getClassRoster(ctx.go.id, new Date(Date.UTC(2026, 9, 17)));
    expect(normal.map((r) => r.status)).toEqual([null]);
  });
});
