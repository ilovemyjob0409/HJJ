import { describe, it, expect } from 'vitest';
import { matchesLeaveSearch } from './leaveSearch';

const baseRow = {
  student: { user: { name: '王小明' } },
  class: { name: '週三高階A班' },
  makeupRequest: null as null | {
    type: string;
    status: string;
    targetClass: { name: string } | null;
    teacher: { user: { name: string } } | null;
  },
};

describe('matchesLeaveSearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesLeaveSearch(baseRow, '')).toBe(true);
  });

  it('matches on student name', () => {
    expect(matchesLeaveSearch(baseRow, '小明')).toBe(true);
  });

  it('matches on class name', () => {
    expect(matchesLeaveSearch(baseRow, '高階A')).toBe(true);
  });

  it('matches "尚未申請" when there is no makeup request', () => {
    expect(matchesLeaveSearch(baseRow, '尚未申請')).toBe(true);
  });

  it('matches the insertion target class name when type is INSERTION', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'INSERTION', status: 'APPROVED', targetClass: { name: '週五初階C班' }, teacher: null },
    };
    expect(matchesLeaveSearch(row, '初階C')).toBe(true);
  });

  it('ignores target class when type is not INSERTION', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'RESCHEDULE', status: 'APPROVED', targetClass: { name: '週五初階C班' }, teacher: null },
    };
    expect(matchesLeaveSearch(row, '初階C')).toBe(false);
  });

  it('matches the human-readable status label, not the raw status code', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'INSERTION', status: 'APPROVED', targetClass: { name: '週五初階C班' }, teacher: null },
    };
    expect(matchesLeaveSearch(row, '已核准')).toBe(true);
    expect(matchesLeaveSearch(row, 'APPROVED')).toBe(false);
  });

  it('matches the one-on-one teacher name and 一對一 keyword', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'ONE_ON_ONE', status: 'APPROVED', targetClass: null, teacher: { user: { name: '茂元老師' } } },
    };
    expect(matchesLeaveSearch(row, '茂元')).toBe(true);
    expect(matchesLeaveSearch(row, '一對一')).toBe(true);
  });

  it('is case-insensitive', () => {
    const row = { ...baseRow, student: { user: { name: 'John Smith' } } };
    expect(matchesLeaveSearch(row, 'john')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesLeaveSearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
