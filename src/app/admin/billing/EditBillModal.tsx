'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// 收費清單與批次明細頁共用的「編輯已定案未繳帳單」彈窗。學生／項目／收費區間
// 唯讀（要換這些請刪單重開）；可改優惠項目、金額，班級帳單另可改計費堂數
// （伺服器會同步加減學生總堂數）。
export interface EditableBillInfo {
  id: string;
  studentName: string;
  itemName: string;
  periodStart: string;
  periodEnd: string;
  classId: string | null;
  billedSessions: number | null;
  unitPrice: number | null;
  monthlyFee: number | null;
  prorationRatio: number | null;
  amountDue: number;
  discounts: { name: string; amount: number }[];
}

interface DiscountItemOption {
  id: string;
  name: string;
  amount: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  BILL_HAS_PAYMENTS: '這筆帳單已有繳款紀錄，無法編輯',
  BILL_SESSIONS_CONSUMED: '扣回的堂數已有部分被上課使用，會讓剩餘堂數變負，請先調整出缺勤',
  BILL_ENROLLMENT_GONE: '找不到對應的班級報名（學生可能已退班或換班），無法調整堂數',
  INVALID_DISCOUNTS: '請填寫完整的優惠項目資訊',
  INVALID_INPUT: '請確認堂數與金額為有效數字',
  MISSING_PRICE: '這筆帳單沒有單價資料，無法重新計算',
};

export default function EditBillModal({
  bill,
  onClose,
  onSaved,
}: {
  bill: EditableBillInfo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [discountItems, setDiscountItems] = useState<DiscountItemOption[]>([]);
  const [discountRows, setDiscountRows] = useState<{ name: string; amount: string }[]>([]);
  const [billedSessionsDraft, setBilledSessionsDraft] = useState('');
  const [amountDueDraft, setAmountDueDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bill) return;
    setDiscountRows(bill.discounts.map((d) => ({ name: d.name, amount: String(d.amount) })));
    setBilledSessionsDraft(bill.billedSessions === null ? '' : String(bill.billedSessions));
    setAmountDueDraft(String(bill.amountDue));
    fetch('/api/admin/billing/settings')
      .then((r) => (r.ok ? r.json() : { discountItems: [] }))
      .then((data) => setDiscountItems(data.discountItems ?? []));
  }, [bill]);

  if (!bill) return null;

  const isClassBill = bill.classId !== null;

  // 毛額：班級＝堂數×單價；個輔＝月費×折算比例（帳單建立時凍結的值）。
  function grossFor(sessionsText: string): number | null {
    if (isClassBill) {
      if (bill!.unitPrice === null) return null;
      const n = Number(sessionsText);
      if (!Number.isFinite(n)) return null;
      return n * bill!.unitPrice;
    }
    if (bill!.monthlyFee === null) return null;
    return Math.round(bill!.monthlyFee * (bill!.prorationRatio ?? 1));
  }

  // 堂數或優惠變動時自動帶入建議金額（毛額－優惠），行政仍可手動覆寫。
  function suggestAmount(sessionsText: string, rows: { name: string; amount: string }[]) {
    const gross = grossFor(sessionsText);
    if (gross === null) return;
    const discountTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    setAmountDueDraft(String(Math.max(0, gross - discountTotal)));
  }

  function mutateDiscountRows(mutate: (rows: { name: string; amount: string }[]) => { name: string; amount: string }[]) {
    const next = mutate(discountRows);
    setDiscountRows(next);
    suggestAmount(billedSessionsDraft, next);
  }

  function onBilledSessionsChange(value: string) {
    setBilledSessionsDraft(value);
    suggestAmount(value, discountRows);
  }

  function addPresetDiscount(id: string) {
    const item = discountItems.find((d) => d.id === id);
    if (!item) return;
    mutateDiscountRows((rows) => [...rows, { name: item.name, amount: String(item.amount) }]);
  }

  // 同單獨開單：全空列自動忽略，半填列擋下請行政補完。
  function collectDiscounts(): { name: string; amount: number }[] | null {
    const filled = discountRows.filter((r) => r.name.trim() !== '' || r.amount.trim() !== '');
    const discounts: { name: string; amount: number }[] = [];
    for (const r of filled) {
      const amount = Number(r.amount);
      if (r.name.trim() === '' || !Number.isInteger(amount) || amount <= 0) return null;
      discounts.push({ name: r.name.trim(), amount });
    }
    return discounts;
  }

  async function save() {
    const discounts = collectDiscounts();
    if (discounts === null) {
      showToast('請填寫完整的優惠項目資訊');
      return;
    }
    setSaving(true);
    try {
      const body: { amountDue: number; discounts: { name: string; amount: number }[]; billedSessions?: number } = {
        amountDue: Number(amountDueDraft),
        discounts,
      };
      if (isClassBill) body.billedSessions = Number(billedSessionsDraft);
      const res = await fetch(`/api/admin/billing/bills/${bill!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '更新失敗，請稍後再試');
        return;
      }
      showToast('已更新帳單');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const canSave = amountDueDraft !== '' && (!isClassBill || billedSessionsDraft !== '');

  return (
    <Modal open onClose={onClose} title="編輯帳單" maxWidthClassName="max-w-lg">
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-borderSubtle bg-cream/40 px-4 py-3 text-sm leading-relaxed text-ink">
          <p>
            學生：<span className="font-semibold">{bill.studentName}</span>／項目：<span className="font-semibold">{bill.itemName}</span>
          </p>
          <p className="mt-1 text-inkMuted">
            收費區間：{formatDateWithWeekday(bill.periodStart)} ～ {formatDateWithWeekday(bill.periodEnd)}
          </p>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-ink">優惠項目（僅套用於這張帳單，名稱與金額可自行輸入）</p>
          <div className="flex flex-col gap-2 rounded-lg border border-borderSubtle p-2">
            {discountRows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="優惠名稱"
                  value={row.name}
                  onChange={(e) => mutateDiscountRows((rows) => rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))}
                  className="min-w-0 flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="金額"
                  value={row.amount}
                  onChange={(e) => mutateDiscountRows((rows) => rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
                  className="w-24 shrink-0"
                />
                <button
                  type="button"
                  aria-label="移除優惠項目"
                  onClick={() => mutateDiscountRows((rows) => rows.filter((_, i) => i !== index))}
                  className="shrink-0 rounded p-1 text-inkMuted transition-colors hover:text-rejected"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {discountItems.length > 0 && (
                <Select value="" onChange={(e) => addPresetDiscount(e.target.value)} className="min-w-0 flex-1">
                  <option value="" disabled>
                    從預設項目帶入…
                  </option>
                  {discountItems.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（－{d.amount.toLocaleString('en-US')} 元）
                    </option>
                  ))}
                </Select>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => mutateDiscountRows((rows) => [...rows, { name: '', amount: '' }])}
                className="shrink-0"
              >
                ＋ 自訂優惠
              </Button>
            </div>
          </div>
        </div>

        {isClassBill && (
          <label className="flex flex-col gap-1 text-sm text-ink">
            計費堂數（調整後學生剩餘堂數會同步增減）
            <Input type="number" min={0} value={billedSessionsDraft} onChange={(e) => onBilledSessionsChange(e.target.value)} className="w-28" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm text-ink">
          金額
          <Input type="number" min={0} value={amountDueDraft} onChange={(e) => setAmountDueDraft(e.target.value)} className="w-32" />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button disabled={!canSave} loading={saving} onClick={save}>
            儲存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
