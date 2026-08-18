import { describe, it, expect } from 'vitest';
import { isValidTimeValue, normalizeTimeInput } from './timeFormat';
import { sortRows } from '@/components/ui/dataTableSort';

describe('normalizeTimeInput', () => {
  it('zero-pads a single-digit hour', () => {
    expect(normalizeTimeInput('9:30')).toBe('09:30');
  });
  it('leaves an already zero-padded time unchanged', () => {
    expect(normalizeTimeInput('09:30')).toBe('09:30');
  });
  it('zero-pads a single-digit minute', () => {
    expect(normalizeTimeInput('14:5')).toBe('14:05');
  });
  it('trims surrounding whitespace while padding', () => {
    expect(normalizeTimeInput(' 9:05 ')).toBe('09:05');
  });
  it('leaves an empty string unchanged', () => {
    expect(normalizeTimeInput('')).toBe('');
  });
  it('leaves input that does not look like H:mm unchanged', () => {
    expect(normalizeTimeInput('上午9點')).toBe('上午9點');
  });
  it('expands 3-digit input as H:MM', () => {
    expect(normalizeTimeInput('905')).toBe('09:05');
  });
  it('expands 4-digit input as HH:MM', () => {
    expect(normalizeTimeInput('1705')).toBe('17:05');
  });
  it('pads a 1-digit minute in colon form', () => {
    expect(normalizeTimeInput('17:5')).toBe('17:05');
  });
});

describe('isValidTimeValue', () => {
  it('accepts zero-padded 24-hour times', () => {
    expect(isValidTimeValue('00:00')).toBe(true);
    expect(isValidTimeValue('09:30')).toBe(true);
    expect(isValidTimeValue('23:59')).toBe(true);
  });
  it('rejects out-of-range or unpadded values', () => {
    expect(isValidTimeValue('24:00')).toBe(false);
    expect(isValidTimeValue('12:60')).toBe(false);
    expect(isValidTimeValue('9:30')).toBe(false);
    expect(isValidTimeValue('上午9點')).toBe(false);
    expect(isValidTimeValue('')).toBe(false);
  });
});

describe('attendance check-in time sort ordering', () => {
  const toRows = (times: (string | null)[]) => times.map((checkInTime, i) => ({ key: String(i), checkInTime }));
  const columns = [{ sortValue: (r: { checkInTime: string | null }) => r.checkInTime }];
  const ascending = (times: (string | null)[]) =>
    sortRows(toRows(times), columns, { columnIndex: 0, direction: 'asc' }).map((r) => r.checkInTime);

  it('reproduces the bug: unpadded raw input sorts out of chronological order', () => {
    // "9:30" (missing zero-pad) sorts as a string after "10:00", even though
    // 9:30am is chronologically earlier.
    expect(ascending(['10:00', '9:30', '09:15'])).toEqual(['09:15', '10:00', '9:30']);
  });

  it('fixes the bug: normalizing inputs before they reach the sort restores chronological order', () => {
    const normalized = ['10:00', '9:30', '09:15'].map(normalizeTimeInput);
    expect(ascending(normalized)).toEqual(['09:15', '09:30', '10:00']);
  });
});
