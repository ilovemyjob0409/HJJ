import { describe, it, expect } from 'vitest';
import { registerDialog, dialogStackSize } from '@/components/ui/dialogStack';

describe('dialogStack', () => {
  it('單一彈窗註冊後即為最上層', () => {
    const a = registerDialog();
    expect(a.isTop()).toBe(true);
    a.unregister();
    expect(dialogStackSize()).toBe(0);
  });

  it('後開的彈窗成為最上層，先開的退居下層（燈箱疊在 Modal 上）', () => {
    const modal = registerDialog();
    const lightbox = registerDialog();
    expect(lightbox.isTop()).toBe(true);
    expect(modal.isTop()).toBe(false);
    lightbox.unregister();
    expect(modal.isTop()).toBe(true);
    modal.unregister();
  });

  it('下層彈窗先關閉（父層整個卸載）不影響上層判斷', () => {
    const modal = registerDialog();
    const lightbox = registerDialog();
    modal.unregister();
    expect(lightbox.isTop()).toBe(true);
    lightbox.unregister();
    expect(dialogStackSize()).toBe(0);
  });

  it('重複 unregister 安全（idempotent），不影響其他彈窗', () => {
    const a = registerDialog();
    const b = registerDialog();
    a.unregister();
    a.unregister();
    expect(b.isTop()).toBe(true);
    expect(dialogStackSize()).toBe(1);
    b.unregister();
  });

  it('三層疊加依 LIFO 順序逐層判斷最上層', () => {
    const first = registerDialog();
    const second = registerDialog();
    const third = registerDialog();
    expect(third.isTop()).toBe(true);
    third.unregister();
    expect(second.isTop()).toBe(true);
    second.unregister();
    expect(first.isTop()).toBe(true);
    first.unregister();
  });
});
