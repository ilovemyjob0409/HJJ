import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { parseDgpaCsv, refreshNationalHolidaysFromDGPA } from './closedDayService';

const SAMPLE_CSV = `西元日期,星期,是否放假,備註
20270101,五,2,開國紀念日
20270102,六,2,
20270103,日,2,
20270928,二,2,孔子誕辰紀念日/教師節
`;

describe('parseDgpaCsv', () => {
  it('keeps only rows with a real holiday name, skipping plain weekends', () => {
    const rows = parseDgpaCsv(SAMPLE_CSV);
    expect(rows).toEqual([
      { date: new Date(Date.UTC(2027, 0, 1)), name: '開國紀念日' },
      { date: new Date(Date.UTC(2027, 8, 28)), name: '孔子誕辰紀念日/教師節' },
    ]);
  });

  it('returns empty array for malformed header (wrong encoding guard)', () => {
    expect(parseDgpaCsv('garbled,header\n1,2')).toEqual([]);
  });
});

describe('refreshNationalHolidaysFromDGPA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and inserts when the year has no NATIONAL rows yet', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('rest/dataset')) {
        return {
          ok: true,
          json: async () => ({
            result: {
              resources: [
                { name: '116年中華民國政府行政機關辦公日曆表', Format: 'CSV', url: 'https://example.test/116.csv' },
                { name: '116年中華民國政府行政機關辦公日曆表_Google行事曆專用', Format: 'CSV', url: 'https://example.test/116-google.csv' },
              ],
            },
          }),
        };
      }
      return { ok: true, text: async () => '﻿' + SAMPLE_CSV };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshNationalHolidaysFromDGPA(new Date(Date.UTC(2026, 11, 31)));
    // 今年（2026 台北曆）已被 Task 2 種過，跳過；明年（2027）沒種過，抓取
    const entry2027 = result.find((r) => r.year === 2027);
    expect(entry2027).toMatchObject({ year: 2027, inserted: 2 });

    const rows = await prisma.closedDay.findMany({ where: { date: { gte: new Date(Date.UTC(2027, 0, 1)) } } });
    expect(rows.some((r) => r.name === '開國紀念日')).toBe(true);
  });

  it('skips a year that already has NATIONAL rows, without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // 2026 已由 Task 2 seedNationalHolidays() 種過（本檔測試共用整合測試 DB，
    // beforeEach 由 vitest 全域 setup 的 resetDb 清過，這裡改用單獨插入一筆代替跑整個 Task 2 種子）
    await prisma.closedDay.create({ data: { date: new Date(Date.UTC(2026, 8, 25)), name: '中秋節', source: 'NATIONAL' } });
    // 2027 也插一筆，這樣兩年都不會觸發 fetch
    await prisma.closedDay.create({ data: { date: new Date(Date.UTC(2027, 8, 15)), name: '中秋節', source: 'NATIONAL' } });

    const result = await refreshNationalHolidaysFromDGPA(new Date(Date.UTC(2026, 5, 1)));
    expect(result.find((r) => r.year === 2026)).toBeUndefined();
    expect(result.find((r) => r.year === 2027)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when the target year resource is not published yet', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { resources: [] } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshNationalHolidaysFromDGPA(new Date(Date.UTC(2026, 5, 1)));
    expect(result).toEqual([]);
  });
});
