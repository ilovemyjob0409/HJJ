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

import { taipeiDateKey } from './tutoringBookingService';

export interface DgpaHolidayRow {
  date: Date;
  name: string;
}

// 只信任「西元日期,星期,是否放假,備註」表頭；表頭對不上代表編碼錯誤或
// 格式改版，直接回空陣列讓呼叫端略過，不要憑錯誤資料寫進資料庫。
export function parseDgpaCsv(csvText: string): DgpaHolidayRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0 || !lines[0].startsWith('西元日期')) return [];
  const rows: DgpaHolidayRow[] = [];
  for (const line of lines.slice(1)) {
    const [dateStr, , isHoliday, name] = line.split(',');
    if (isHoliday !== '2' || !name || !name.trim()) continue;
    const y = Number(dateStr.slice(0, 4));
    const m = Number(dateStr.slice(4, 6));
    const d = Number(dateStr.slice(6, 8));
    rows.push({ date: new Date(Date.UTC(y, m - 1, d)), name: name.trim() });
  }
  return rows;
}

// 民國年 = 西元年 - 1911。只找「標準版」（排除 Google 行事曆專用版）。
export async function fetchDgpaResourceUrl(rocYear: number): Promise<string | null> {
  const res = await fetch('https://data.gov.tw/api/v2/rest/dataset/14718');
  if (!res.ok) return null;
  const data = await res.json();
  const resources: { name?: string; url?: string; Format?: string }[] = data?.result?.resources ?? [];
  const match = resources.find(
    (r) => r.name?.includes(`${rocYear}年`) && r.name?.includes('辦公日曆表') && !r.name?.includes('Google') && r.Format === 'CSV'
  );
  return match?.url ?? null;
}

async function refreshYearIfMissing(year: number): Promise<{ year: number; inserted: number } | null> {
  const existing = await prisma.closedDay.count({
    where: { source: 'NATIONAL', date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
  });
  if (existing > 0) return null;

  const rocYear = year - 1911;
  const url = await fetchDgpaResourceUrl(rocYear);
  if (!url) return null;

  const csvRes = await fetch(url);
  if (!csvRes.ok) return null;
  const rawText = await csvRes.text();
  const text = rawText.startsWith('﻿') ? rawText.slice(1) : rawText;
  const rows = parseDgpaCsv(text);
  if (rows.length === 0) return null;

  const result = await prisma.closedDay.createMany({
    data: rows.map((r) => ({ date: r.date, name: r.name, source: 'NATIONAL' as const })),
    skipDuplicates: true,
  });
  return { year, inserted: result.count };
}

// 每日排程呼叫：檢查「今年／明年」（台北曆年）是否已有國定假日資料，
// 沒有才去抓——政府行事曆通常年中就會公告下一年度，這樣一發布就近日內
// 自動補上，不用死等到 1/1；已種過的年度即使被管理員手動刪掉幾筆
// （標記某天照常上課）也不會被整批覆蓋回去。
export async function refreshNationalHolidaysFromDGPA(now: Date = new Date()): Promise<{ year: number; inserted: number }[]> {
  const [y] = taipeiDateKey(now).split('-').map(Number);
  const results = await Promise.all([refreshYearIfMissing(y), refreshYearIfMissing(y + 1)]);
  return results.filter((r): r is { year: number; inserted: number } => r !== null);
}
