'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import AlertModal from '@/components/ui/AlertModal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { taipeiDateKey } from '@/lib/taipeiDate';
import { getPaidState } from '@/lib/billingCalc';

export interface PaymentModalBill {
  id: string;
  amountDue: number;
  payments: { id: string; amount: number; paidOn: string; method: 'CASH' | 'TRANSFER'; note: string | null }[];
}

const METHOD_LABEL: Record<'CASH' | 'TRANSFER', string> = { CASH: '現金', TRANSFER: '轉帳' };

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_AMOUNT: '金額必須大於 0',
  BILL_NOT_FINALIZED: '這筆帳單尚未定案，無法登記繳款',
  MISSING_FIELDS: '請完整填寫金額、日期與方式',
};

interface PaymentModalProps {
  bill: PaymentModalBill | null;
  onClose: () => void;
  onChanged: () => void;
}

// 繳款登記彈窗：批次頁與主頁「單獨開單帳單」共用。bill 由呼叫端從自己已載入的
// 清單中找出對應那一筆傳進來（沒有獨立的單筆帳單 GET route），送出/刪除成功後
// 呼叫 onChanged() 讓呼叫端 refetch，這裡不自己管理帳單資料本身。
export default function PaymentModal({ bill, onClose, onChanged }: PaymentModalProps) {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [overpayOpen, setOverpayOpen] = useState(false);

  useEffect(() => {
    setAmount('');
    setPaidOn(taipeiDateKey(new Date()));
    setMethod('CASH');
    setNote('');
  }, [bill?.id]);

  async function submit() {
    if (!bill) return;
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0 || !paidOn) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/billing/bills/${bill.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: n, paidOn, method, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'OVERPAY') {
          setOverpayOpen(true);
        } else {
          showToast(ERROR_MESSAGES[data.error] ?? '登記繳款失敗，請稍後再試');
        }
        return;
      }
      showToast('已登記繳款');
      setAmount('');
      setNote('');
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function deletePayment(paymentId: string) {
    if (!(await confirm('確定要刪除這筆繳款紀錄嗎？', { danger: true }))) return;
    setDeletingId(paymentId);
    try {
      const res = await fetch(`/api/admin/billing/payments/${paymentId}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('刪除失敗，請稍後再試');
        return;
      }
      showToast('已刪除');
      onChanged();
    } finally {
      setDeletingId(null);
    }
  }

  const paidState = bill ? getPaidState(bill.amountDue, bill.payments) : null;

  return (
    <>
      <Modal open={bill !== null} onClose={onClose} title="繳款登記" maxWidthClassName="max-w-lg">
        {bill && paidState && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">
              應繳 {bill.amountDue.toLocaleString('en-US')} 元・已繳 {paidState.paid.toLocaleString('en-US')} 元・尚欠{' '}
              <span className={paidState.outstanding > 0 ? 'font-semibold text-rejected' : 'font-semibold text-approved'}>
                {paidState.outstanding.toLocaleString('en-US')} 元
              </span>
            </p>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-ink">繳款紀錄</h3>
              {bill.payments.length === 0 ? (
                <p className="text-sm text-inkMuted">尚無繳款紀錄</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {bill.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm text-ink">
                      <span>
                        {formatDateWithWeekday(p.paidOn)}・{p.amount.toLocaleString('en-US')} 元・{METHOD_LABEL[p.method]}
                        {p.note && <span className="text-inkMuted">・{p.note}</span>}
                      </span>
                      <Button variant="link" tone="danger" loading={deletingId === p.id} onClick={() => deletePayment(p.id)}>
                        刪除
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-borderSubtle pt-3">
              <h3 className="text-sm font-bold text-ink">新增繳款</h3>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-inkMuted">
                  金額
                  <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-inkMuted">
                  日期
                  <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-inkMuted">
                  方式
                  <Select value={method} onChange={(e) => setMethod(e.target.value as 'CASH' | 'TRANSFER')}>
                    <option value="CASH">現金</option>
                    <option value="TRANSFER">轉帳</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-inkMuted">
                  備註
                  <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-32" />
                </label>
                <Button onClick={submit} loading={submitting} disabled={!amount || Number(amount) <= 0 || paidState.outstanding <= 0}>
                  新增
                </Button>
              </div>
              {paidState.outstanding <= 0 && <p className="text-xs text-inkMuted">這筆帳單已繳清</p>}
            </div>
          </div>
        )}
      </Modal>

      <AlertModal open={overpayOpen} onClose={() => setOverpayOpen(false)} title="超過尚欠金額">
        {paidState && `這筆帳單尚欠 ${paidState.outstanding.toLocaleString('en-US')} 元，請輸入不超過此金額的繳款。`}
      </AlertModal>

      {ConfirmDialog}
    </>
  );
}
