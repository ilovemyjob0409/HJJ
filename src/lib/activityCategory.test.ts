import { describe, it, expect } from 'vitest';
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS } from './activityCategory';

describe('ACTIVITY_CATEGORY_LABELS', () => {
  it('has a Chinese label for every category in ACTIVITY_CATEGORIES', () => {
    for (const category of ACTIVITY_CATEGORIES) {
      expect(ACTIVITY_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('maps each category to its expected label', () => {
    expect(ACTIVITY_CATEGORY_LABELS.CAMP).toBe('營隊');
    expect(ACTIVITY_CATEGORY_LABELS.LECTURE).toBe('講座');
    expect(ACTIVITY_CATEGORY_LABELS.COMPETITION).toBe('比賽');
    expect(ACTIVITY_CATEGORY_LABELS.OBSERVATION).toBe('觀摩課');
  });
});
