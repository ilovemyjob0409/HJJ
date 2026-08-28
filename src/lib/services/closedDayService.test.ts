import { describe, it, expect } from 'vitest';
import { seedNationalHolidays, listClosedDays, addClosedDay, removeClosedDay } from './closedDayService';

describe('closedDayService', () => {
  it('seeds national holidays idempotently', async () => {
    const first = await seedNationalHolidays();
    expect(first).toBeGreaterThan(0);
    const second = await seedNationalHolidays();
    expect(second).toBe(0); // 再跑一次不重複

    const all = await listClosedDays();
    expect(all.some((d) => d.name.includes('中秋'))).toBe(true);
    expect(all.every((d) => d.source === 'NATIONAL')).toBe(true);
  });

  it('adds a custom closed day and rejects duplicates', async () => {
    const day = await addClosedDay(new Date(Date.UTC(2026, 8, 30)), '颱風停課');
    expect(day.source).toBe('CUSTOM');
    await expect(addClosedDay(new Date(Date.UTC(2026, 8, 30)), '重複')).rejects.toThrow('DUPLICATE_DATE');
  });

  it('removes a day (holiday held-as-usual) and range-filters', async () => {
    await seedNationalHolidays();
    const all = await listClosedDays();
    await removeClosedDay(all[0].id);
    expect((await listClosedDays()).length).toBe(all.length - 1);

    const ranged = await listClosedDays(new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)));
    expect(ranged.every((d) => d.date >= new Date(Date.UTC(2026, 9, 1)))).toBe(true);
  });

  it('does not resurrect a manually deleted national holiday on re-seed', async () => {
    await seedNationalHolidays();
    const all = await listClosedDays();
    const toDelete = all.find((d) => d.source === 'NATIONAL');
    expect(toDelete).toBeDefined();
    await removeClosedDay(toDelete!.id);

    await seedNationalHolidays(); // simulates the next GET /closed-days call

    const after = await listClosedDays();
    expect(after.some((d) => d.id === toDelete!.id)).toBe(false);
    expect(after.some((d) => d.date.getTime() === toDelete!.date.getTime())).toBe(false);
  });
});
