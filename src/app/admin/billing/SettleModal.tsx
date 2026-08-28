'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { getPaidState } from '@/lib/billingCalc';

export interface SettleModalBill {
  id: string;
  amountDue: number;
  payments: { amount: number }[];
}

interface SettlePreview {
  attendedSessions: number;
  unitPrice: number;
  suggestedAmount: number;
  paid: number;
  diff: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  ALREADY_SETTLED: '這筆帳單已結算過，無法重複結算',
  MISSING_FIELDS: '請填寫金額與備註',
};

interface SettleModalProps {
  bill: SettleModalBill | null;
  onClose: () => void;
  onChanged: () => void;
}

// 退班結算彈窗。GET 結算試算：CLASS 帳單成功時回傳「已上堂數 × 單價」試算；
// TUTORING（或其他非 CLASS）帳單，billSettlementService.previewSettlement 會丟
// NOT_A_CLASS_BILL，route 依統一慣例回 400——這裡把「試算失敗」一律當「沒有
// 試算可用」處理（不只挑特定錯誤碼/狀態碼），只留金額＋備註讓行政手動輸入。
// brief 原文假設 preview 對 TUTORING 帳單回 404，但實測 route 是 400
// {error:'NOT_A_CLASS_BILL'}，已依實際行為調整、記在 task-14-report.md。
export default function SettleModal({ bill, onClose, onChanged }: SettleModalProps) {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<SettlePreview | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!bill) return;
    const billId = bill.id;
    const fallbackAmount = bill.amountDue;
    setPreview(null);
    setNote('');
    setLoadingPreview(true);
    fetch(`/api/admin/billing/bills/${billId}/settle`)
      .then(async (res) => {
        if (!res.ok) {
          setAmount(String(fallbackAmount));
          return;
        }
        const data: SettlePreview = await res.json();
        setPreview(data);
        setAmount(String(data.suggestedAmount));
      })
      .finally(() => setLoadingPreview(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill?.id, bill?.amountDue]);

  async function submit() {
    if (!bill) return;
    const n = Number(amount);
    if (amount === '' || !Number.isFinite(n) || n < 0 || !note.trim()) return;
    if (!(await confirm(`確定要以 ${n.toLocaleString('en-US')} 元結算這筆帳單嗎？此動作無法復原。`, { danger: true }))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/billing/bills/${bill.id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: n, note: note.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '結算失敗，請稍後再試');
        return;
      }
      showToast('已結算');
      onChanged();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const localPaid = bill ? getPaidState(bill.amountDue, bill.payments).paid : 0;

  return (
    <>
      <Modal open={bill !== null} onClose={onClose} title="退班結算" maxWidthClassName="max-w-lg">
        {bill && (
          <div className="flex flex-col gap-4">
            {loadingPreview ? (
              <div className="flex flex-col gap-2">
                <div className="skeleton-shimmer h-4 w-48 rounded" />
                <div className="skeleton-shimmer h-4 w-32 rounded" />
              </div>
            ) : (
              <>
                {preview ? (
                  <div className="rounded-lg border border-borderSubtle bg-cream/40 px-4 py-3 text-sm leading-relaxed text-ink">
                    <p>
                      區間內已實際上課 {preview.attendedSessions} 堂 × 單價 {preview.unitPrice} 元 ＝ 建議結算金額{' '}
                      {preview.suggestedAmount.toLocaleString('en-US')} 元
                    </p>
                    <p className="mt-1">
                      已繳 {preview.paid.toLocaleString('en-US')} 元 →{' '}
                      {preview.diff > 0 ? (
                        <span className="font-semibold text-rejected">應追收 {preview.diff.toLocaleString('en-US')} 元</span>
                      ) : preview.diff < 0 ? (
                        <span className="font-semibold text-approved">應退 {Math.abs(preview.diff).toLocaleString('en-US')} 元</span>
                      ) : (
                        '金額相符，無需追退'
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-ink">
                    目前應繳 {bill.amountDue.toLocaleString('en-US')} 元・已繳 {localPaid.toLocaleString('en-US')} 元
                  </p>
                )}

                <label className="flex flex-col gap-1 text-sm text-ink">
                  結算金額
                  <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink">
                  備註（必填）
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="請說明結算原因" />
                </label>

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={onClose} disabled={submitting}>
                    取消
                  </Button>
                  <Button onClick={submit} loading={submitting} disabled={amount === '' || Number(amount) < 0 || !note.trim()}>
                    確認結算
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}
