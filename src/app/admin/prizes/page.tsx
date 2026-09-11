'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import AlertModal from '@/components/ui/AlertModal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday, formatTimestampWithWeekdayTaipei } from '@/lib/dateFormat';
import PrizeFormModal, { PrizeRow } from './PrizeFormModal';

interface RedemptionRow {
  id: string;
  studentName: string;
  studentNumber: string | null;
  prizeName: string;
  points: number;
  createdAt: string;
  deadlineKey: string;
}

interface ErrorInfo {
  title: string;
  message: string;
}

// 核銷／撤銷業務錯誤 → 中文；不得把原始錯誤碼顯示給使用者。
const REDEMPTION_ERROR_LABELS: Record<string, string> = {
  ALREADY_PICKED_UP: '這筆已領取過',
  ALREADY_CANCELLED: '這筆已取消',
  ALREADY_EXPIRED: '這筆已逾期退點',
  NOT_FOUND: '找不到這筆兌換',
  NOT_PENDING: '這筆兌換已處理過',
};

function redemptionErrorLabel(code: string): string {
  return REDEMPTION_ERROR_LABELS[code] ?? '發生錯誤，請稍後再試';
}

type PrizeModalState = { mode: 'create' } | { mode: 'edit'; prize: PrizeRow } | null;

export default function AdminPrizesPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(true);
  const [pickupBusyId, setPickupBusyId] = useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  const [prizes, setPrizes] = useState<PrizeRow[]>([]);
  const [prizesLoading, setPrizesLoading] = useState(true);
  const [prizeModal, setPrizeModal] = useState<PrizeModalState>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

  async function loadRedemptions() {
    try {
      const res = await fetch('/api/prize-redemptions');
      if (res.ok) setRedemptions(await res.json());
    } finally {
      setRedemptionsLoading(false);
    }
  }

  async function loadPrizes() {
    try {
      const res = await fetch('/api/prizes');
      if (res.ok) setPrizes(await res.json());
    } finally {
      setPrizesLoading(false);
    }
  }

  useEffect(() => {
    loadRedemptions();
    loadPrizes();
  }, []);

  async function handlePickup(r: RedemptionRow) {
    const ok = await confirm(`確定「${r.studentName}」已領取「${r.prizeName}」嗎？`);
    if (!ok) return;
    setPickupBusyId(r.id);
    try {
      const res = await fetch(`/api/prize-redemptions/${r.id}/pickup`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorInfo({ title: '核銷失敗', message: redemptionErrorLabel(data.error) });
        return;
      }
      showToast('已核銷');
      loadRedemptions();
    } finally {
      setPickupBusyId(null);
    }
  }

  async function handleCancel(r: RedemptionRow) {
    const ok = await confirm(`確定要撤銷「${r.studentName}」兌換的「${r.prizeName}」嗎？已扣的 ${r.points} 點將會退回。`, {
      danger: true,
    });
    if (!ok) return;
    setCancelBusyId(r.id);
    try {
      const res = await fetch(`/api/prize-redemptions/${r.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorInfo({ title: '撤銷失敗', message: redemptionErrorLabel(data.error) });
        return;
      }
      showToast('已撤銷並退點');
      loadRedemptions();
    } finally {
      setCancelBusyId(null);
    }
  }

  async function handleDeletePrize(p: PrizeRow) {
    const ok = await confirm(`確定刪除「${p.name}」嗎？此動作無法復原。`, { danger: true });
    if (!ok) return;
    setDeleteBusyId(p.id);
    try {
      const res = await fetch(`/api/prizes/${p.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorInfo({
          title: '刪除失敗',
          message:
            data.error === 'HAS_REDEMPTIONS'
              ? '此獎品已有兌換紀錄，無法刪除——請改用「編輯」把狀態設為下架。'
              : data.error === 'NOT_FOUND'
                ? '找不到這個獎品'
                : '發生錯誤，請稍後再試',
        });
        return;
      }
      showToast('已刪除獎品');
      loadPrizes();
    } finally {
      setDeleteBusyId(null);
    }
  }

  const redemptionColumns: Column<RedemptionRow>[] = [
    {
      header: '學生',
      render: (r) => (
        <div className="text-left">
          <div className="font-medium">{r.studentName}</div>
          <div className="text-xs text-inkMuted">{r.studentNumber ?? '-'}</div>
        </div>
      ),
      sortValue: (r) => r.studentName,
    },
    { header: '獎品', render: (r) => r.prizeName, sortValue: (r) => r.prizeName },
    { header: '點數', render: (r) => <span className="font-semibold text-brandDark">{r.points}</span>, sortValue: (r) => r.points },
    {
      header: '兌換時間',
      render: (r) => formatTimestampWithWeekdayTaipei(r.createdAt),
      sortValue: (r) => r.createdAt,
    },
    {
      header: '領取期限',
      render: (r) => formatDateWithWeekday(r.deadlineKey),
      sortValue: (r) => r.deadlineKey,
    },
    {
      header: '操作',
      render: (r) => (
        <div className="flex items-center justify-center gap-3">
          <Button variant="link" loading={pickupBusyId === r.id} onClick={() => handlePickup(r)}>
            已領取
          </Button>
          <Button variant="link" tone="danger" loading={cancelBusyId === r.id} onClick={() => handleCancel(r)}>
            撤銷退點
          </Button>
        </div>
      ),
    },
  ];

  const prizeColumns: Column<PrizeRow>[] = [
    {
      header: '縮圖',
      render: (p) =>
        p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
          <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" className="mx-auto h-16 w-16 rounded-lg object-cover" />
        ) : (
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-stripe text-xl" aria-hidden="true">
            🎁
          </div>
        ),
    },
    { header: '名稱', render: (p) => p.name, sortValue: (p) => p.name },
    { header: '點數', render: (p) => p.points, sortValue: (p) => p.points },
    {
      header: '庫存',
      render: (p) => <span className={p.stock === 0 ? 'font-semibold text-rejected' : ''}>{p.stock}</span>,
      sortValue: (p) => p.stock,
    },
    {
      header: '狀態',
      render: (p) => (
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
            p.active ? 'bg-approvedBg text-approved' : 'bg-borderSubtle text-inkMuted'
          }`}
        >
          {p.active ? '上架' : '下架'}
        </span>
      ),
      sortValue: (p) => (p.active ? 1 : 0),
    },
    { header: '排序', render: (p) => p.sortOrder, sortValue: (p) => p.sortOrder },
    {
      header: '操作',
      render: (p) => (
        <div className="flex justify-end gap-3 sm:justify-start">
          <Button variant="link" onClick={() => setPrizeModal({ mode: 'edit', prize: p })}>
            編輯
          </Button>
          <Button variant="link" tone="danger" loading={deleteBusyId === p.id} onClick={() => handleDeletePrize(p)}>
            刪除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">獎品管理</h1>

      <Card className="mb-6">
        <h2 className="mb-3 font-bold text-ink">待領獎核銷</h2>
        <DataTable
          columns={redemptionColumns}
          rows={redemptions}
          keyField={(r) => r.id}
          loading={redemptionsLoading}
          emptyText="目前沒有待領獎的兌換"
        />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-ink">獎品清單</h2>
          <Button onClick={() => setPrizeModal({ mode: 'create' })}>＋ 新增獎品</Button>
        </div>
        <DataTable
          columns={prizeColumns}
          rows={prizes}
          keyField={(p) => p.id}
          loading={prizesLoading}
          emptyText="目前沒有獎品，點右上角新增"
        />
      </Card>

      <PrizeFormModal
        open={prizeModal !== null}
        mode={prizeModal?.mode ?? 'create'}
        prize={prizeModal?.mode === 'edit' ? prizeModal.prize : null}
        onClose={() => setPrizeModal(null)}
        onSaved={() => {
          setPrizeModal(null);
          loadPrizes();
        }}
        onImageUploaded={loadPrizes}
      />

      <AlertModal open={errorInfo !== null} onClose={() => setErrorInfo(null)} title={errorInfo?.title ?? '發生錯誤'}>
        {errorInfo?.message}
      </AlertModal>

      {ConfirmDialog}
    </>
  );
}
