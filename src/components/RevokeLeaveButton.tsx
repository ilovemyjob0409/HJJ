'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

// 撤銷請假（學生／老師／行政共用）。掛有補課時警告會一併撤銷；
// 補課已點名則後端會擋下（MAKEUP_HAS_ATTENDANCE）。
export default function RevokeLeaveButton({
  leaveRequestId,
  hasMakeup,
  onDone,
}: {
  leaveRequestId: string;
  hasMakeup: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const warning = hasMakeup
      ? '確定要撤銷這筆請假嗎？此請假的補課申請將一併撤銷。'
      : '確定要撤銷這筆請假嗎？';
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leave-requests/${leaveRequestId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error === 'MAKEUP_HAS_ATTENDANCE' ? '補課已有點名紀錄，無法撤銷' : '撤銷失敗，請稍後再試');
        return;
      }
      showToast('已撤銷請假');
      if (onDone) onDone();
      else router.refresh();
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
      撤銷
    </button>
  );
}
