'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

// 已核准補課的「申請撤銷」：送出後由行政確認，確認前補課仍有效。
export default function CancelMakeupButton({ makeupRequestId }: { makeupRequestId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!confirm('確定要申請撤銷這筆補課嗎？將由教室行政確認後生效。')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/makeup-requests/${makeupRequestId}/cancel-request`, { method: 'POST' });
      if (!res.ok) {
        showToast('申請失敗，請稍後再試');
        return;
      }
      showToast('已送出撤銷申請，待教室確認');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="text-xs text-inkMuted underline hover:text-rejected disabled:opacity-50"
    >
      申請撤銷
    </button>
  );
}
