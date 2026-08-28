'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import DataTable, { Column } from '@/components/ui/DataTable';
import AlertModal from '@/components/ui/AlertModal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface FeeTierRow {
  id: string;
  name: string;
  sessionsPerWeek: number;
  monthlyFee: number;
}

interface TierFormValues {
  name: string;
  sessionsPerWeek: string;
  monthlyFee: string;
}

const EMPTY_TIER_FORM: TierFormValues = { name: '', sessionsPerWeek: '', monthlyFee: '' };

interface DiscountItemRow {
  id: string;
  name: string;
  amount: number;
}

interface DiscountFormValues {
  name: string;
  amount: string;
}

const EMPTY_DISCOUNT_FORM: DiscountFormValues = { name: '', amount: '' };

export default function SettingsTab() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [feeTiers, setFeeTiers] = useState<FeeTierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deductionCap, setDeductionCap] = useState('');
  const [paymentInfo, setPaymentInfo] = useState('');
  const [savingCap, setSavingCap] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [newTier, setNewTier] = useState<TierFormValues>(EMPTY_TIER_FORM);
  const [addingTier, setAddingTier] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TierFormValues>(EMPTY_TIER_FORM);
  const [tierInUseAlertOpen, setTierInUseAlertOpen] = useState(false);
  const [discountItems, setDiscountItems] = useState<DiscountItemRow[]>([]);
  const [newDiscount, setNewDiscount] = useState<DiscountFormValues>(EMPTY_DISCOUNT_FORM);
  const [addingDiscount, setAddingDiscount] = useState(false);
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [discountEditForm, setDiscountEditForm] = useState<DiscountFormValues>(EMPTY_DISCOUNT_FORM);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/billing/settings');
      if (res.ok) {
        const data = await res.json();
        setFeeTiers(data.feeTiers);
        setDeductionCap(String(data.deductionCap));
        setPaymentInfo(data.paymentInfo);
        setDiscountItems(data.discountItems ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveDeductionCap() {
    const value = Number(deductionCap);
    if (deductionCap.trim() === '' || Number.isNaN(value) || value < 0) {
      showToast('請輸入有效的折抵上限');
      return;
    }
    setSavingCap(true);
    try {
      const res = await fetch('/api/admin/billing/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deductionCap: value }),
      });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
      showToast('已儲存折抵上限');
    } finally {
      setSavingCap(false);
    }
  }

  async function savePaymentInfo() {
    setSavingInfo(true);
    try {
      const res = await fetch('/api/admin/billing/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentInfo }),
      });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
      showToast('已儲存繳費資訊');
    } finally {
      setSavingInfo(false);
    }
  }

  async function createTier() {
    if (!newTier.name.trim() || newTier.sessionsPerWeek.trim() === '' || newTier.monthlyFee.trim() === '') {
      showToast('請填寫完整的級距資訊');
      return;
    }
    setAddingTier(true);
    try {
      const res = await fetch('/api/admin/billing/fee-tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTier.name.trim(),
          sessionsPerWeek: Number(newTier.sessionsPerWeek),
          monthlyFee: Number(newTier.monthlyFee),
        }),
      });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setNewTier(EMPTY_TIER_FORM);
      showToast('已新增級距');
      load();
    } finally {
      setAddingTier(false);
    }
  }

  function startEditTier(row: FeeTierRow) {
    setEditForm({ name: row.name, sessionsPerWeek: String(row.sessionsPerWeek), monthlyFee: String(row.monthlyFee) });
    setEditingTierId(row.id);
  }

  async function saveEditTier(id: string) {
    if (!editForm.name.trim() || editForm.sessionsPerWeek.trim() === '' || editForm.monthlyFee.trim() === '') {
      showToast('請填寫完整的級距資訊');
      return;
    }
    const res = await fetch(`/api/admin/billing/fee-tiers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name.trim(),
        sessionsPerWeek: Number(editForm.sessionsPerWeek),
        monthlyFee: Number(editForm.monthlyFee),
      }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return;
    }
    setEditingTierId(null);
    showToast('已更新級距');
    load();
  }

  async function deleteTier(row: FeeTierRow) {
    if (!(await confirm(`確定要刪除「${row.name}」嗎？`, { danger: true }))) return;
    const res = await fetch(`/api/admin/billing/fee-tiers/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === 'TIER_IN_USE') {
        setTierInUseAlertOpen(true);
      } else {
        showToast('刪除失敗，請稍後再試');
      }
      return;
    }
    showToast('已刪除');
    load();
  }

  async function createDiscountItem() {
    if (!newDiscount.name.trim() || newDiscount.amount.trim() === '') {
      showToast('請填寫完整的優惠項目資訊');
      return;
    }
    setAddingDiscount(true);
    try {
      const res = await fetch('/api/admin/billing/discount-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDiscount.name.trim(), amount: Number(newDiscount.amount) }),
      });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setNewDiscount(EMPTY_DISCOUNT_FORM);
      showToast('已新增優惠項目');
      load();
    } finally {
      setAddingDiscount(false);
    }
  }

  function startEditDiscountItem(row: DiscountItemRow) {
    setDiscountEditForm({ name: row.name, amount: String(row.amount) });
    setEditingDiscountId(row.id);
  }

  async function saveEditDiscountItem(id: string) {
    if (!discountEditForm.name.trim() || discountEditForm.amount.trim() === '') {
      showToast('請填寫完整的優惠項目資訊');
      return;
    }
    const res = await fetch(`/api/admin/billing/discount-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: discountEditForm.name.trim(), amount: Number(discountEditForm.amount) }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return;
    }
    setEditingDiscountId(null);
    showToast('已更新優惠項目');
    load();
  }

  async function deleteDiscountItem(row: DiscountItemRow) {
    if (!(await confirm(`確定要刪除「${row.name}」嗎？`, { danger: true }))) return;
    const res = await fetch(`/api/admin/billing/discount-items/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，請稍後再試');
      return;
    }
    showToast('已刪除');
    load();
  }

  const discountColumns: Column<DiscountItemRow>[] = [
    {
      header: '名稱',
      render: (r) =>
        editingDiscountId === r.id ? (
          <Input
            value={discountEditForm.name}
            onChange={(e) => setDiscountEditForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full py-1 text-sm"
          />
        ) : (
          r.name
        ),
    },
    {
      header: '優惠金額',
      render: (r) =>
        editingDiscountId === r.id ? (
          <Input
            type="number"
            min={0}
            value={discountEditForm.amount}
            onChange={(e) => setDiscountEditForm((f) => ({ ...f, amount: e.target.value }))}
            className="w-24 py-1 text-sm"
          />
        ) : (
          `${r.amount.toLocaleString('en-US')} 元`
        ),
    },
    {
      header: '操作',
      render: (r) =>
        editingDiscountId === r.id ? (
          <div className="flex justify-center gap-1">
            <Button className="px-2 py-1 text-xs" onClick={() => saveEditDiscountItem(r.id)}>
              儲存
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditingDiscountId(null)}>
              取消
            </Button>
          </div>
        ) : (
          <div className="flex justify-center gap-1">
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => startEditDiscountItem(r)}>
              編輯
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => deleteDiscountItem(r)}>
              刪除
            </Button>
          </div>
        ),
    },
  ];

  const columns: Column<FeeTierRow>[] = [
    {
      header: '名稱',
      render: (r) =>
        editingTierId === r.id ? (
          <Input
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full py-1 text-sm"
          />
        ) : (
          r.name
        ),
    },
    {
      header: '每週堂數',
      render: (r) =>
        editingTierId === r.id ? (
          <Input
            type="number"
            min={0}
            value={editForm.sessionsPerWeek}
            onChange={(e) => setEditForm((f) => ({ ...f, sessionsPerWeek: e.target.value }))}
            className="w-20 py-1 text-sm"
          />
        ) : (
          r.sessionsPerWeek
        ),
    },
    {
      header: '月費',
      render: (r) =>
        editingTierId === r.id ? (
          <Input
            type="number"
            min={0}
            value={editForm.monthlyFee}
            onChange={(e) => setEditForm((f) => ({ ...f, monthlyFee: e.target.value }))}
            className="w-24 py-1 text-sm"
          />
        ) : (
          `${r.monthlyFee.toLocaleString('en-US')} 元`
        ),
    },
    {
      header: '操作',
      render: (r) =>
        editingTierId === r.id ? (
          <div className="flex justify-center gap-1">
            <Button className="px-2 py-1 text-xs" onClick={() => saveEditTier(r.id)}>
              儲存
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditingTierId(null)}>
              取消
            </Button>
          </div>
        ) : (
          <div className="flex justify-center gap-1">
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => startEditTier(r)}>
              編輯
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => deleteTier(r)}>
              刪除
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <Card className="mb-6">
        <p className="mb-3 font-bold text-ink">英數級距表</p>
        <DataTable columns={columns} rows={feeTiers} keyField={(r) => r.id} loading={loading} emptyText="目前沒有收費級距" />
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-borderStrong p-3">
          <label className="text-xs text-inkMuted">
            名稱
            <Input
              placeholder="例如：一週三堂"
              value={newTier.name}
              onChange={(e) => setNewTier((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 block"
            />
          </label>
          <label className="text-xs text-inkMuted">
            每週堂數
            <Input
              type="number"
              min={0}
              value={newTier.sessionsPerWeek}
              onChange={(e) => setNewTier((f) => ({ ...f, sessionsPerWeek: e.target.value }))}
              className="mt-1 block w-20"
            />
          </label>
          <label className="text-xs text-inkMuted">
            月費
            <Input
              type="number"
              min={0}
              value={newTier.monthlyFee}
              onChange={(e) => setNewTier((f) => ({ ...f, monthlyFee: e.target.value }))}
              className="mt-1 block w-24"
            />
          </label>
          <Button onClick={createTier} loading={addingTier}>
            新增級距
          </Button>
        </div>
      </Card>

      <Card className="mb-6">
        <p className="mb-3 font-bold text-ink">優惠項目</p>
        <p className="mb-3 text-xs text-inkMuted">僅在單獨開單時可勾選套用到單一帳單（例如首次報名的企業特約），不會長期掛在學生身上</p>
        <DataTable columns={discountColumns} rows={discountItems} keyField={(r) => r.id} loading={loading} emptyText="目前沒有優惠項目" />
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-borderStrong p-3">
          <label className="text-xs text-inkMuted">
            名稱
            <Input
              placeholder="例如：台積電特約"
              value={newDiscount.name}
              onChange={(e) => setNewDiscount((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 block"
            />
          </label>
          <label className="text-xs text-inkMuted">
            優惠金額
            <Input
              type="number"
              min={0}
              value={newDiscount.amount}
              onChange={(e) => setNewDiscount((f) => ({ ...f, amount: e.target.value }))}
              className="mt-1 block w-24"
            />
          </label>
          <Button onClick={createDiscountItem} loading={addingDiscount}>
            新增優惠項目
          </Button>
        </div>
      </Card>

      <Card className="mb-6">
        <p className="mb-2 font-bold text-ink">折抵上限</p>
        <p className="mb-3 text-xs text-inkMuted">圍棋批次產生時套用；已定案帳單不受影響</p>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} value={deductionCap} onChange={(e) => setDeductionCap(e.target.value)} className="w-24" />
          <Button onClick={saveDeductionCap} loading={savingCap}>
            儲存
          </Button>
        </div>
      </Card>

      <Card>
        <p className="mb-2 font-bold text-ink">繳費資訊</p>
        <Textarea rows={4} value={paymentInfo} onChange={(e) => setPaymentInfo(e.target.value)} className="w-full" />
        <div className="mt-2">
          <Button onClick={savePaymentInfo} loading={savingInfo}>
            儲存
          </Button>
        </div>
      </Card>

      <AlertModal open={tierInUseAlertOpen} onClose={() => setTierInUseAlertOpen(false)} title="無法刪除">
        仍有報名使用此級距
      </AlertModal>
      {ConfirmDialog}
    </>
  );
}
