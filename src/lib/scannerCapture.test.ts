import { describe, it, expect } from 'vitest';
import { charFromKeyCode, isSubmitKeyCode } from './scannerCapture';

// 掃碼槍（鍵盤模擬）在中文輸入法開啟時，keydown 的 e.key 會變成
// 'Process'，但 e.code（實體按鍵）不受影響——字元重建一律走 e.code，
// 輸入法開著也能掃。
describe('charFromKeyCode', () => {
  it('maps letter key codes to uppercase letters', () => {
    expect(charFromKeyCode('KeyS')).toBe('S');
    expect(charFromKeyCode('KeyA')).toBe('A');
    expect(charFromKeyCode('KeyZ')).toBe('Z');
  });

  it('maps digit row and numpad key codes to digits', () => {
    expect(charFromKeyCode('Digit0')).toBe('0');
    expect(charFromKeyCode('Digit9')).toBe('9');
    expect(charFromKeyCode('Numpad0')).toBe('0');
    expect(charFromKeyCode('Numpad7')).toBe('7');
  });

  it('returns null for modifier, submit, and unrelated key codes', () => {
    expect(charFromKeyCode('ShiftLeft')).toBeNull();
    expect(charFromKeyCode('Enter')).toBeNull();
    expect(charFromKeyCode('NumpadEnter')).toBeNull();
    expect(charFromKeyCode('Tab')).toBeNull();
    expect(charFromKeyCode('Minus')).toBeNull();
    expect(charFromKeyCode('KeyAA')).toBeNull();
    expect(charFromKeyCode('Digit10')).toBeNull();
  });
});

describe('isSubmitKeyCode', () => {
  it('treats Enter and NumpadEnter as submit', () => {
    expect(isSubmitKeyCode('Enter')).toBe(true);
    expect(isSubmitKeyCode('NumpadEnter')).toBe(true);
  });

  it('does not treat other keys as submit', () => {
    expect(isSubmitKeyCode('KeyS')).toBe(false);
    expect(isSubmitKeyCode('Space')).toBe(false);
  });
});
