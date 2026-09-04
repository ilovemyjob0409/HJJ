import { describe, expect, it } from 'vitest';
import { isDateTimeFilled } from './Input';

// date/time 欄位的內部文字被 globals.css 釘成 placeholder 灰（Safari 深夜模式
// 半透明 segment 的處理），已填值時要靠 data-filled 換回 ink 色——否則從月曆
// 選完日期，欄位文字仍是灰色，看不出到底選了沒（2026-09-03 Mac 版回報）。
describe('isDateTimeFilled', () => {
  it('date 欄位有值 → filled', () => {
    expect(isDateTimeFilled('date', '2026-09-03')).toBe(true);
  });

  it('time 欄位有值 → filled', () => {
    expect(isDateTimeFilled('time', '17:05')).toBe(true);
  });

  it('date 欄位空字串 → 未填', () => {
    expect(isDateTimeFilled('date', '')).toBe(false);
  });

  it('date 欄位 value undefined（非受控）→ 未填', () => {
    expect(isDateTimeFilled('date', undefined)).toBe(false);
  });

  it('text 欄位不受影響，一律不標', () => {
    expect(isDateTimeFilled('text', 'abc')).toBe(false);
    expect(isDateTimeFilled(undefined, '2026-09-03')).toBe(false);
  });
});
