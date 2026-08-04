'use client';

import { ReactNode, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from './useDialogA11y';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidthClassName?: string;
  // flush：內容自理內距與標題列（活動詳情等滿版版面用）。
  flush?: boolean;
}

export default function Modal({ open, onClose, title, children, maxWidthClassName = 'max-w-md', flush = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, panelRef, onClose);
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`animate-modal-in max-h-[90vh] w-full ${maxWidthClassName} overflow-y-auto rounded-xl bg-card ${flush ? '' : 'p-5'} shadow-lg outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {!flush && (
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
            <button onClick={onClose} className="shrink-0 text-inkMuted hover:text-ink" aria-label="關閉">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
