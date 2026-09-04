import { describe, it, expect } from 'vitest';
import { CLASS_HIDDEN_STATUSES, STATUS_OPTIONS, TUTORING_HIDDEN_STATUSES, visibleStatusOptions } from './attendanceStatusOptions';

describe('visibleStatusOptions', () => {
  it('returns every option when nothing is hidden', () => {
    expect(visibleStatusOptions(undefined, 'UNMARKED')).toEqual(STATUS_OPTIONS);
    expect(visibleStatusOptions([], 'PRESENT')).toEqual(STATUS_OPTIONS);
  });

  // 2026-09-04 使用者定案：個別輔導點名只留未點名/出席——額度以預約＋出席為準、
  // 請假走取消預約流程，缺席一律留在未點名讓隔日缺席推播接手。
  it('tutoring rosters only offer 未點名/出席', () => {
    const values = visibleStatusOptions(TUTORING_HIDDEN_STATUSES, 'UNMARKED').map((o) => o.value);
    expect(values).toEqual(['UNMARKED', 'PRESENT']);
  });

  // 2026-09-04 使用者定案：一般班級留未點名/出席/請假/未報名/缺席未請假（拿掉遲到/早退）。
  it('class rosters offer 未點名/出席/請假/未報名/缺席未請假', () => {
    const values = visibleStatusOptions(CLASS_HIDDEN_STATUSES, 'UNMARKED').map((o) => o.value);
    expect(values).toEqual(['UNMARKED', 'PRESENT', 'ON_LEAVE', 'NOT_REGISTERED', 'ABSENT']);
  });

  it('keeps a hidden status visible when it is the current selection', () => {
    const tutoring = visibleStatusOptions(TUTORING_HIDDEN_STATUSES, 'ABSENT').map((o) => o.value);
    expect(tutoring).toEqual(['UNMARKED', 'PRESENT', 'ABSENT']);
    const cls = visibleStatusOptions(CLASS_HIDDEN_STATUSES, 'LATE').map((o) => o.value);
    expect(cls).toEqual(['UNMARKED', 'PRESENT', 'LATE', 'ON_LEAVE', 'NOT_REGISTERED', 'ABSENT']);
  });

  it('does not resurrect other hidden statuses alongside the current one', () => {
    const values = visibleStatusOptions(TUTORING_HIDDEN_STATUSES, 'NOT_REGISTERED').map((o) => o.value);
    expect(values).not.toContain('ON_LEAVE');
    expect(values).not.toContain('ABSENT');
    expect(values).toContain('NOT_REGISTERED');
  });
});
