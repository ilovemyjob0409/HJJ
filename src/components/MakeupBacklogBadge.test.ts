import { describe, it, expect } from 'vitest';
import { classItemLabel } from './MakeupBacklogBadge';

describe('classItemLabel', () => {
  it('缺席且補課待審時顯示「缺席（補課待審）」', () => {
    expect(classItemLabel({ date: '2026-09-05', reason: 'ABSENT', makeupPending: true })).toBe('缺席（補課待審）');
  });

  it('缺席且非補課待審時顯示「缺席」', () => {
    expect(classItemLabel({ date: '2026-09-05', reason: 'ABSENT', makeupPending: false })).toBe('缺席');
  });

  it('請假待審時顯示「請假（補課待審）」', () => {
    expect(classItemLabel({ date: '2026-09-05', reason: 'LEAVE', makeupPending: true })).toBe('請假（補課待審）');
  });

  it('請假非待審時顯示「請假」', () => {
    expect(classItemLabel({ date: '2026-09-05', reason: 'LEAVE', makeupPending: false })).toBe('請假');
  });
});
