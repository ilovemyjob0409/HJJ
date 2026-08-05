'use client';

import { useCallback, useState } from 'react';
import Modal from './Modal';
import Button from './Button';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // true：確認鍵走危險樣式（刪除等不可逆操作）
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

// 取代 window.confirm()：await confirm(message) 回傳 boolean，UI 走既有 Modal
// （focus trap／Esc／捲動鎖定／深色模式），而不是不受控的原生對話框。
// 用法：const { confirm, ConfirmDialog } = useConfirm(); 並在元件樹某處 render {ConfirmDialog}。
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ message, resolve, ...options });
    });
  }, []);

  function respond(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  const ConfirmDialog = (
    <Modal open={pending !== null} onClose={() => respond(false)} title={pending?.title ?? '確認'}>
      {pending && (
        <div className="flex flex-col gap-4">
          <p className="whitespace-pre-line text-sm text-ink">{pending.message}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => respond(false)}>
              {pending.cancelLabel ?? '取消'}
            </Button>
            <Button
              onClick={() => respond(true)}
              className={pending.danger ? 'bg-rejected text-white hover:bg-rejected/90' : ''}
            >
              {pending.confirmLabel ?? '確定'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );

  return { confirm, ConfirmDialog };
}
