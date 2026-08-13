import { describe, it, expect } from 'vitest';
import { STATUS_OPTIONS, TUTORING_HIDDEN_STATUSES, visibleStatusOptions } from './attendanceStatusOptions';

describe('visibleStatusOptions', () => {
  it('returns every option when nothing is hidden', () => {
    expect(visibleStatusOptions(undefined, 'UNMARKED')).toEqual(STATUS_OPTIONS);
    expect(visibleStatusOptions([], 'PRESENT')).toEqual(STATUS_OPTIONS);
  });

  it('hides 請假 and 未報名 for tutoring rosters', () => {
    const values = visibleStatusOptions(TUTORING_HIDDEN_STATUSES, 'UNMARKED').map((o) => o.value);
    expect(values).toEqual(['UNMARKED', 'PRESENT', 'LATE', 'LEFT_EARLY', 'ABSENT']);
  });

  it('keeps a hidden status visible when it is the current selection', () => {
    const values = visibleStatusOptions(TUTORING_HIDDEN_STATUSES, 'ON_LEAVE').map((o) => o.value);
    expect(values).toEqual(['UNMARKED', 'PRESENT', 'LATE', 'LEFT_EARLY', 'ON_LEAVE', 'ABSENT']);
  });

  it('does not resurrect other hidden statuses alongside the current one', () => {
    const values = visibleStatusOptions(TUTORING_HIDDEN_STATUSES, 'NOT_REGISTERED').map((o) => o.value);
    expect(values).not.toContain('ON_LEAVE');
    expect(values).toContain('NOT_REGISTERED');
  });
});
