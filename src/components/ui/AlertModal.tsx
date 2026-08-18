'use client';

import { ReactNode } from 'react';
import Modal from './Modal';

interface AlertModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// 阻斷式警示彈窗（表單防呆用）：置中警示圖示＋標題＋說明＋「知道了」。
// 底層沿用 Modal（focus trap／Esc／捲動鎖定／深淺色都處理好了）；
// flush 自排版面，留白比一般 Modal 寬鬆。
export default function AlertModal({ open, onClose, title, children }: AlertModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} flush maxWidthClassName="max-w-[400px]">
      <div className="px-8 pb-8 pt-10 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#E05C4C]/[.14]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#E05C4C"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-[30px] w-[30px]"
            aria-hidden="true"
          >
            <path d="M12 9v4" />
            <circle cx="12" cy="16.5" r="0.6" fill="#E05C4C" />
            <path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </div>
        <h2 className="mb-3 text-xl font-bold text-ink">{title}</h2>
        <div className="mb-7 text-[15px] leading-[1.9] text-inkMuted">{children}</div>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg bg-brand px-4 py-3 text-[15px] font-semibold text-brandInk transition-colors hover:bg-brandDark"
        >
          知道了
        </button>
      </div>
    </Modal>
  );
}
