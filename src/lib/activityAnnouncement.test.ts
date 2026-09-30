import { describe, it, expect } from 'vitest';
import { formatAnnouncementTime, AUDIENCE_LABEL } from './activityAnnouncement';

describe('formatAnnouncementTime', () => {
  it('台北時間：日期（星期）＋ HH:mm', () => {
    expect(formatAnnouncementTime('2026-10-01T06:05:00Z')).toBe('2026/10/1（四） 14:05');
  });

  it('台北午夜顯示 00 不是 24（hourCycle h23）', () => {
    expect(formatAnnouncementTime('2026-09-30T16:30:00Z')).toBe('2026/10/1（四） 00:30');
  });
});

describe('AUDIENCE_LABEL', () => {
  it('兩種對象都有中文標籤', () => {
    expect(AUDIENCE_LABEL).toEqual({ REGISTERED: '已報名學生', ALL_STUDENTS: '全體學生' });
  });
});
