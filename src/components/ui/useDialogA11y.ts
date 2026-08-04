'use client';

import { RefObject, useEffect, useRef } from 'react';
import { registerDialog } from './dialogStack';

// body 捲動鎖定計數：巢狀彈窗（Modal＋燈箱、Modal＋裁切）最後一層關閉才還原 overflow。
let scrollLockCount = 0;
let bodyOverflowBackup = '';

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    bodyOverflowBackup = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = bodyOverflowBackup;
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0
  );
}

// 彈窗無障礙三件套：開啟時 focus 移入並以 Tab 圈限於容器、Esc 關閉（僅最上層）、
// body 捲動鎖定；關閉時還原 focus 至開啟前的元素。容器需可 focus（tabIndex={-1}）。
export function useDialogA11y(active: boolean, containerRef: RefObject<HTMLElement>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const dialog = registerDialog();
    lockBodyScroll();

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!container.contains(document.activeElement)) {
      container.focus({ preventScroll: true });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!dialog.isTop()) return;
      if (e.key === 'Escape') {
        // 中文輸入法組字中的 Esc 是取消組字，不應關閉彈窗。
        if (e.isComposing) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !container) return;
      const items = focusableIn(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !container.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (current === first || current === container)) {
        e.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      dialog.unregister();
      unlockBodyScroll();
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
    // container 走 ref、onClose 走 onCloseRef，僅 active 切換需要重新掛載。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
