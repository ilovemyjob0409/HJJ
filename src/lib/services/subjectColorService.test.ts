import { describe, it, expect } from 'vitest';
import { listSubjectColors, setSubjectColor } from './subjectColorService';

describe('setSubjectColor', () => {
  it('creates a color entry for a new subject', async () => {
    const saved = await setSubjectColor('圍棋', '#B8763F');
    expect(saved.subject).toBe('圍棋');
    expect(saved.color).toBe('#B8763F');
  });

  it('updates in place when the subject already has a color', async () => {
    await setSubjectColor('圍棋', '#B8763F');
    await setSubjectColor('圍棋', '#123456');

    const all = await listSubjectColors();
    expect(all).toHaveLength(1);
    expect(all[0].color).toBe('#123456');
  });
});

describe('listSubjectColors', () => {
  it('returns every saved subject/color pair', async () => {
    await setSubjectColor('圍棋', '#B8763F');
    await setSubjectColor('數學', '#8B6BC9');

    const all = await listSubjectColors();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.subject).sort()).toEqual(['圍棋', '數學'].sort());
  });
});
