import { describe, it, expect } from 'vitest';
import { CLASS_HIDDEN_STATUSES, MINIMAL_HIDDEN_STATUSES, STATUS_OPTIONS, visibleStatusOptions } from './attendanceStatusOptions';

describe('visibleStatusOptions', () => {
  it('returns every option when nothing is hidden', () => {
    expect(visibleStatusOptions(undefined, 'UNMARKED')).toEqual(STATUS_OPTIONS);
    expect(visibleStatusOptions([], 'PRESENT')).toEqual(STATUS_OPTIONS);
  });

  // 2026-09-04 使用者定案：除一般班級外（個輔/弈廳/活動/一對一）點名只留
  // 未點名/出席。個輔：額度以預約＋出席為準、請假走取消預約流程，缺席一律
  // 留在未點名讓隔日缺席推播接手；弈廳：只有出席才扣堂票。
  it('non-class rosters only offer 未點名/出席', () => {
    const values = visibleStatusOptions(MINIMAL_HIDDEN_STATUSES, 'UNMARKED').map((o) => o.value);
    expect(values).toEqual(['UNMARKED', 'PRESENT']);
  });

  // 2026-09-04 使用者定案：一般班級留未點名/出席/請假/未報名/缺席未請假（拿掉遲到/早退）。
  it('class rosters offer 未點名/出席/請假/未報名/缺席未請假', () => {
    const values = visibleStatusOptions(CLASS_HIDDEN_STATUSES, 'UNMARKED').map((o) => o.value);
    expect(values).toEqual(['UNMARKED', 'PRESENT', 'ON_LEAVE', 'NOT_REGISTERED', 'ABSENT']);
  });

  it('keeps a hidden status visible when it is the current selection', () => {
    const minimal = visibleStatusOptions(MINIMAL_HIDDEN_STATUSES, 'ABSENT').map((o) => o.value);
    expect(minimal).toEqual(['UNMARKED', 'PRESENT', 'ABSENT']);
    const cls = visibleStatusOptions(CLASS_HIDDEN_STATUSES, 'LATE').map((o) => o.value);
    expect(cls).toEqual(['UNMARKED', 'PRESENT', 'LATE', 'ON_LEAVE', 'NOT_REGISTERED', 'ABSENT']);
  });

  it('does not resurrect other hidden statuses alongside the current one', () => {
    const values = visibleStatusOptions(MINIMAL_HIDDEN_STATUSES, 'NOT_REGISTERED').map((o) => o.value);
    expect(values).not.toContain('ON_LEAVE');
    expect(values).not.toContain('ABSENT');
    expect(values).toContain('NOT_REGISTERED');
  });
});
