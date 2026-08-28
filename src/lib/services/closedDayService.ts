import { prisma } from '@/lib/db';

// 台灣國定假日種子。資料來源：data.gov.tw/dataset/14718（人事行政總處）115/116年版，
// 2026-08-28 人工核對。後續年度用停課日曆後台自行增補；專用自動更新機制另行開發。
export const NATIONAL_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-09-25', name: '中秋節' },
  { date: '2026-09-28', name: '孔子誕辰紀念日/教師節' },
  { date: '2026-10-09', name: '補假' },
  { date: '2026-10-10', name: '國慶日' },
  { date: '2026-10-25', name: '臺灣光復暨金門古寧頭大捷紀念日' },
  { date: '2026-10-26', name: '補假' },
  { date: '2026-12-25', name: '行憲紀念日' },
  { date: '2027-01-01', name: '開國紀念日' },
  { date: '2027-02-04', name: '小年夜' },
  { date: '2027-02-05', name: '農曆除夕' },
  { date: '2027-02-06', name: '春節' },
  { date: '2027-02-07', name: '春節' },
  { date: '2027-02-08', name: '春節' },
  { date: '2027-02-09', name: '補假' },
  { date: '2027-02-10', name: '補假' },
  { date: '2027-02-28', name: '和平紀念日' },
  { date: '2027-03-01', name: '補假' },
  { date: '2027-04-04', name: '兒童節' },
  { date: '2027-04-05', name: '清明節' },
  { date: '2027-04-06', name: '補假' },
  { date: '2027-04-30', name: '補假' },
  { date: '2027-05-01', name: '勞動節' },
  { date: '2027-06-09', name: '端午節' },
  { date: '2027-09-15', name: '中秋節' },
  { date: '2027-09-28', name: '孔子誕辰紀念日/教師節' },
  { date: '2027-10-10', name: '國慶日' },
  { date: '2027-10-11', name: '補假' },
  { date: '2027-10-25', name: '臺灣光復暨金門古寧頭大捷紀念日' },
  { date: '2027-12-24', name: '補假' },
  { date: '2027-12-25', name: '行憲紀念日' },
  { date: '2027-12-31', name: '補假' },
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
