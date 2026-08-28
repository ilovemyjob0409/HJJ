'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { withStopPropagation } from './stopPropagation';

export interface ActionMenuItem {
  key: string;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'default' | 'danger';
}

const MENU_WIDTH = 144; // w-36

// 操作欄的「⋯」收合選單。面板用 portal 畫到 body、position: fixed 由按鈕實際
// 座標定位——表格容器有 overflow-x-auto（DataTable 慣例），面板若照一般
// absolute 定位跟著表格走，會被表格自身的裁切邊界吃掉（不管往上或往下彈，
// 只是被吃的邊不同），portal 是唯一能徹底跳脫任何祖先 overflow 裁切的做法。
export default function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8);
    // 下方空間不夠（例如表格最後一列）就往上彈，跟原生右鍵選單同樣的避讓邏輯。
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
      setPos({ bottom: window.innerHeight - rect.top + 4, left: Math.max(8, left) });
    } else {
      setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // 表格捲動／視窗縮放時面板位置會跟按鈕脫節，直接關閉比即時重算簡單可靠。
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={withStopPropagation(() => (open ? setOpen(false) : openMenu()))}
        aria-label="更多操作"
        aria-expanded={open}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-inkMuted hover:bg-stripe hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: MENU_WIDTH }}
            className="animate-fade-in z-50 rounded-lg border border-borderStrong bg-card py-1 text-left shadow-md"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled || item.loading}
                onClick={withStopPropagation(() => {
                  setOpen(false);
                  item.onClick();
                })}
                className={`block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-stripe disabled:cursor-default disabled:opacity-50 ${
                  item.tone === 'danger' ? 'text-rejected' : 'text-ink'
                }`}
              >
                {item.loading ? '處理中…' : item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
