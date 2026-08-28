import { describe, it, expect } from 'vitest';
import {
  computeClassSessionDates,
  countOpenSessions,
  computeDeduction,
  computeTutoringProration,
  buildClassBillDetail,
  getPaidState,
} from './billingCalc';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('computeClassSessionDates', () => {
  it('expands weekly session dates and marks closed days', () => {
    // 週六班（weekday 6），9/1～9/30：9/5, 9/12, 9/19, 9/26
    const entries = computeClassSessionDates(6, D(2026, 9, 1), D(2026, 9, 30), [
      { date: D(2026, 9, 26), name: '測試假日' },
      { date: D(2026, 9, 15), name: '不在上課日的假日' }, // 週二，不影響
    ]);
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']);
    expect(entries[3]).toMatchObject({ closed: true, closedName: '測試假日' });
    expect(countOpenSessions(entries)).toBe(3);
  });

  it('crosses month and year boundaries', () => {
    // 週一班（weekday 1），2026/12/28～2027/1/11：12/28, 1/4, 1/11
    const entries = computeClassSessionDates(1, D(2026, 12, 28), D(2027, 1, 11), []);
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-12-28', '2027-01-04', '2027-01-11']);
  });

  it('handles sunday classes (weekday 0) and inclusive endpoints', () => {
    // 9/6 與 9/27 都是週日，區間端點含入
    const entries = computeClassSessionDates(0, D(2026, 9, 6), D(2026, 9, 27), []);
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
  });
});

describe('computeDeduction', () => {
  it('caps at the configured limit and floors at zero', () => {
    expect(computeDeduction(5, 2)).toBe(2);
    expect(computeDeduction(1, 2)).toBe(1);
    expect(computeDeduction(0, 2)).toBe(0);
    expect(computeDeduction(null, 2)).toBe(0); // 未設堂數上限的報名
    expect(computeDeduction(-3, 2)).toBe(0); // 超上餘額為負不倒扣
  });
});

describe('computeTutoringProration', () => {
  it('full month → 1, half month → 0.5, capped at 1', () => {
    expect(computeTutoringProration(D(2026, 9, 1), D(2026, 9, 30))).toBe(1); // 30天→4週→100%
    expect(computeTutoringProration(D(2026, 9, 15), D(2026, 9, 30))).toBe(0.5); // 16天→2週→50%
    expect(computeTutoringProration(D(2026, 9, 1), D(2026, 10, 31))).toBe(1); // 超過一個月上限 1
    expect(computeTutoringProration(D(2026, 9, 24), D(2026, 9, 30))).toBe(0.25); // 7天→1週→25%
  });
});

describe('buildClassBillDetail', () => {
  it('builds frozen detail with formula, deduction only when present', () => {
    const entries = computeClassSessionDates(6, D(2026, 9, 1), D(2026, 9, 30), [{ date: D(2026, 9, 26), name: '假日' }]);
    const withDeduction = buildClassBillDetail(entries, { previousRemaining: 5, cap: 2, deducted: 2 }, 1, 500);
    expect(withDeduction.deduction).toMatchObject({ previousRemaining: 5, deducted: 2 });
    expect(withDeduction.formula).toBe('3 − 2 ＝ 1 堂 × 500 ＝ 500 元');

    const noDeduction = buildClassBillDetail(entries, null, 3, 500);
    expect(noDeduction.deduction).toBeNull();
    expect(noDeduction.formula).toBe('3 堂 × 500 ＝ 1,500 元');
  });
});

describe('getPaidState', () => {
  it('derives UNPAID / PARTIAL / PAID from amountDue and payments', () => {
    expect(getPaidState(2000, [])).toMatchObject({ paid: 0, outstanding: 2000, state: 'UNPAID' });
    expect(getPaidState(2000, [{ amount: 500 }])).toMatchObject({ paid: 500, outstanding: 1500, state: 'PARTIAL' });
    expect(getPaidState(2000, [{ amount: 500 }, { amount: 1500 }])).toMatchObject({ outstanding: 0, state: 'PAID' });
  });
});
