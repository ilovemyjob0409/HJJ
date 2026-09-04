import { describe, it, expect } from 'vitest';
import { hasDate, rowsFromResponse, classRosterFromResponse } from './attendanceHubFetch';

describe('hasDate', () => {
  it('rejects the empty string left by clearing a native date input', () => {
    expect(hasDate('')).toBe(false);
  });

  it('accepts a normal yyyy-mm-dd value', () => {
    expect(hasDate('2026-09-03')).toBe(true);
  });
});

describe('rowsFromResponse', () => {
  it('returns null for an error response so the caller keeps its current rows', () => {
    expect(rowsFromResponse(false, { error: 'date required' })).toBeNull();
  });

  it('returns null when an ok response body is not an array', () => {
    expect(rowsFromResponse(true, { error: 'unexpected' })).toBeNull();
    expect(rowsFromResponse(true, null)).toBeNull();
  });

  it('returns the rows when the response is ok and the body is an array', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(rowsFromResponse(true, rows)).toEqual(rows);
    expect(rowsFromResponse(true, [])).toEqual([]);
  });
});

describe('classRosterFromResponse', () => {
  it('returns null for an error response', () => {
    expect(classRosterFromResponse(false, { error: 'date required' })).toBeNull();
  });

  it('returns null when the body has no roster array', () => {
    expect(classRosterFromResponse(true, {})).toBeNull();
    expect(classRosterFromResponse(true, null)).toBeNull();
  });

  it('returns roster and quota map when the body is well-formed', () => {
    const body = { roster: [{ studentId: 's1' }], quotaByStudentId: { s1: { totalSessions: 10 } } };
    expect(classRosterFromResponse(true, body)).toEqual(body);
  });

  it('defaults quota map to an empty object when missing', () => {
    expect(classRosterFromResponse(true, { roster: [] })).toEqual({ roster: [], quotaByStudentId: {} });
  });
});
