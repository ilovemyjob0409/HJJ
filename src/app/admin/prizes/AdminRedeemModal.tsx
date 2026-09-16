'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import AlertModal from '@/components/ui/AlertModal';
import { useToast } from '@/components/ui/Toast';
import { PrizeRow } from './PrizeFormModal';

interface StudentSummary {
  id: string;
  name: string;
  studentNumber: string | null;
  classes: { id: string; name: string }[];
  regular: number;
  redeemOnly: number;
}

// 代兌換業務錯誤 → 中文；不得把原始錯誤碼顯示給使用者。
const REDEEM_ERROR_LABELS: Record<string, string> = {
  PRIZE_UNAVAILABLE: '獎品已下架或不存在',
  OUT_OF_STOCK: '獎品已換完',
  ALREADY_REDEEMED: '這位學生已兌換過此獎品',
  INSUFFICIENT_POINTS: '這位學生的點數不足',
  STUDENT_NOT_FOUND: '找不到這位學生',
};

interface AdminRedeemModalProps {
  open: boolean;
  prize: PrizeRow | null;
  onClose: () => void;
  // 代兌換成功：呼叫端關閉彈窗＋重抓獎品清單（庫存已扣）
  onRedeemed: () => void;
}

// 行政櫃台代兌換：搜尋選學生（顯示可用點數）→ 確認 → 直接建成「已領取」。
export default function AdminRedeemModal({ open, prize, onClose, onRedeemed }: AdminRedeemModalProps) {
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedId('');
    setLoading(true);
    fetch('/api/points/summary')
      .then((r) => (r.ok ? r.json() : []))
      .then(setStudents)
      .finally(() => setLoading(false));
  }, [open]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.studentNumber ?? '').toLowerCase().includes(q) ||
          s.classes.some((c) => c.name.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [students, search]);

  const selected = students.find((s) => s.id === selectedId) ?? null;
  const available = selected ? selected.regular + selected.redeemOnly : 0;

  async function handleSubmit() {
    if (!prize || !selected) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/prize-redemptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizeId: prize.id, studentId: selected.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(REDEEM_ERROR_LABELS[(data as { error?: string }).error ?? ''] ?? '發生錯誤，請稍後再試');
        return;
      }
      showToast(`已為 ${selected.name} 兌換「${prize.name}」並完成領取`);
      onRedeemed();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={prize ? `代兌換：${prize.name}（${prize.points} 點）` : '代兌換'}>
        {!selected ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink">選擇學生</p>
            <Input
              placeholder="搜尋姓名、學號或班級名稱…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {loading && <p className="text-sm text-inkMuted">學生資料載入中…</p>}
            {matches.length > 0 && (
              <div className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-borderStrong">
                {matches.map((s) => {
                  const balance = s.regular + s.redeemOnly;
                  const enough = prize !== null && balance >= prize.points;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!enough}
                      onClick={() => setSelectedId(s.id)}
                      className="flex items-center justify-between gap-3 border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 enabled:hover:bg-stripe disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{s.name}</span>
                        <span className="block truncate text-xs text-inkMuted">
                          {[s.studentNumber, s.classes.map((c) => c.name).join('、')].filter(Boolean).join('｜') || '-'}
                        </span>
                      </span>
                      <span className={`shrink-0 text-xs ${enough ? 'text-inkMuted' : 'font-semibold text-rejected'}`}>
                        {enough ? `可用 ${balance} 點` : `點數不足（${balance} 點）`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!loading && search.trim() && matches.length === 0 && (
              <p className="text-sm text-inkMuted">沒有符合的學生</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-stripe px-4 py-3 text-sm text-ink">
              <p>
                學生：<span className="font-semibold">{selected.name}</span>
                {selected.studentNumber ? <span className="ml-2 text-xs text-inkMuted">{selected.studentNumber}</span> : null}
              </p>
              <p className="mt-1">
                將扣 <span className="font-semibold text-brandDark">{prize?.points ?? 0}</span> 點（可用 {available} 點，兌換後剩{' '}
                {available - (prize?.points ?? 0)} 點）
              </p>
            </div>
            <p className="text-xs text-inkMuted">確認後視同現場已交付獎品，直接列為「已領取」，不會進待領獎清單。</p>
            <div className="flex items-center justify-end gap-3">
              <Button variant="link" tone="muted" disabled={submitting} onClick={() => setSelectedId('')}>
                重選學生
              </Button>
              <Button loading={submitting} onClick={handleSubmit}>
                確認兌換
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <AlertModal open={errorMessage !== null} onClose={() => setErrorMessage(null)} title="代兌換失敗">
        {errorMessage}
      </AlertModal>
    </>
  );
}
