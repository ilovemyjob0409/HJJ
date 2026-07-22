import { describe, it, expect } from 'vitest';
import { maskName } from './maskName';

describe('maskName', () => {
  it('leaves a 1-character name unchanged', () => {
    expect(maskName('王')).toBe('王');
  });

  it('masks the second character of a 2-character name', () => {
    expect(maskName('王明')).toBe('王Ｏ');
  });

  it('masks the middle character of a 3-character name', () => {
    expect(maskName('王大明')).toBe('王Ｏ明');
  });

  it('masks every middle character of a 4-character name', () => {
    expect(maskName('歐陽大明')).toBe('歐ＯＯ明');
  });
});
