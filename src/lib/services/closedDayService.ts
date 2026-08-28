import { prisma } from '@/lib/db';

// 台灣國定假日種子（2026-09 起）。⚠️ 上線前由使用者對照人事行政總處
// 行事曆核對；之後年度用停課日曆後台自行增補即可（表是唯一來源）。
export const NATIONAL_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-09-25', name: '中秋節' },
  { date: '2026-09-28', name: '教師節' },
  { date: '2026-10-09', name: '國慶連假' },
  { date: '2026-10-10', name: '國慶日' },
  { date: '2026-10-25', name: '光復節' },
  { date: '2026-10-26', name: '光復節補假' },
  { date: '2026-12-25', name: '行憲紀念日' },
  { date: '2027-01-01', name: '元旦' },
  { date: '2027-02-05', name: '農曆除夕' },
  { date: '2027-02-06', name: '春節初一' },
  { date: '2027-02-07', name: '春節初二' },
  { date: '2027-02-08', name: '春節初三' },
  { date: '2027-02-09', name: '春節補假' },
  { date: '2027-02-28', name: '和平紀念日' },
  { date: '2027-03-01', name: '和平紀念日補假' },
  { date: '2027-04-04', name: '兒童節' },
  { date: '2027-04-05', name: '清明節' },
  { date: '2027-04-06', name: '清明連假補假' },
  { date: '2027-05-01', name: '勞動節' },
  { date: '2027-06-09', name: '端午節' },
  { date: '2027-09-15', name: '中秋節' },
  { date: '2027-10-10', name: '國慶日' },
  { date: '2027-10-11', name: '國慶日補假' },
  { date: '2027-10-25', name: '光復節' },
  { date: '2027-12-25', name: '行憲紀念日' },
];

function toUtcDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function seedNationalHolidays(): Promise<number> {
  const result = await prisma.closedDay.createMany({
    data: NATIONAL_HOLIDAYS.map((h) => ({ date: toUtcDate(h.date), name: h.name, source: 'NATIONAL' as const })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function listClosedDays(from?: Date, to?: Date) {
  return prisma.closedDay.findMany({
    where: from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : undefined,
    orderBy: { date: 'asc' },
  });
}

export async function addClosedDay(date: Date, name: string) {
  const existing = await prisma.closedDay.findUnique({ where: { date } });
  if (existing) throw new Error('DUPLICATE_DATE');
  return prisma.closedDay.create({ data: { date, name, source: 'CUSTOM' } });
}

export async function removeClosedDay(id: string): Promise<void> {
  await prisma.closedDay.delete({ where: { id } });
}
