'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { getPaidState } from '@/lib/billingCalc';
import BatchWizardModal from './BatchWizardModal';
import StandaloneBillModal from './StandaloneBillModal';
import PaymentModal from './PaymentModal';
import SettleModal from './SettleModal';
import ClosedDaysTab from './ClosedDaysTab';
import SettingsTab from './SettingsTab';
import BillDetailBlock, { BillDetailJson } from '@/components/BillDetailBlock';
import ActionMenu, { ActionMenuItem } from '@/components/ui/ActionMenu';

type TabKey = 'batches' | 'closedDays' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'batches', label: '批次' },
  { key: 'closedDays', label: '停課日' },
  { key: 'settings', label: '設定' },
];

const KIND_LABEL: Record<'CLASS' | 'TUTORING', string> = { CLASS: '圍棋班級', TUTORING: '英數個別輔導' };

interface BatchRow {
  id: string;
  kind: 'CLASS' | 'TUTORING';
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'FINALIZED';
  totalDue: number | null;
  totalPaid: number | null;
  totalOutstanding: number | null;
}

interface StandaloneBillRow {
  id: string;
  student: { id: string; user: { name: string } };
  class: { name: string } | null;
  tutoringEnrollment: { program: { name: string } } | null;
  periodStart: string;
  periodEnd: string;
  amountDue: number;
  detail: BillDetailJson;
  payments: { id: string; amount: number; paidOn: string; method: 'CASH' | 'TRANSFER'; note: string | null }[];
  notifiedAt: string | null;
  settledAsWithdrawal: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  BILL_NOT_FINALIZED: '這筆帳單非已定案狀態，無法通知',
  ALREADY_PAID: '這筆帳單已繳清，不需提醒繳費',
};

// 批次狀態徽章：草稿＝pendingBg／已定案＝approvedBg（本頁與草稿頁各自內嵌一份，
// 只有這兩處用得到，沒有獨立拆共用檔）。
// 不 export：page.tsx 只能有 Next.js 認可的特殊具名匯出（否則 next build 的
// 型別檢查會報錯），這兩個純內部元件保持模組私有即可。
function BatchStatusBadge({ status }: { status: 'DRAFT' | 'FINALIZED' }) {
  return status === 'DRAFT' ? (
    <span className="inline-block whitespace-nowrap rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">草稿</span>
  ) : (
    <span className="inline-block whitespace-nowrap rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">
      已定案
    </span>
  );
}

const PAID_STATE_CONFIG: Record<'UNPAID' | 'PARTIAL' | 'PAID', { label: string; bg: string; text: string }> = {
  UNPAID: { label: '未繳', bg: 'bg-rejectedBg', text: 'text-rejected' },
  PARTIAL: { label: '部分繳', bg: 'bg-pendingBg', text: 'text-pending' },
  PAID: { label: '繳清', bg: 'bg-approvedBg', text: 'text-approved' },
};

function PaidStateBadge({ amountDue, payments }: { amountDue: number; payments: { amount: number }[] }) {
  const { state } = getPaidState(amountDue, payments);
  const { label, bg, text } = PAID_STATE_CONFIG[state];
  return <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
}

export default function AdminBillingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState<TabKey>('batches');
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [standaloneBills, setStandaloneBills] = useState<StandaloneBillRow[]>([]);
  const [standaloneLoading, setStandaloneLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [standaloneModalOpen, setStandaloneModalOpen] = useState(false);
  const [expandedStandaloneId, setExpandedStandaloneId] = useState<string | null>(null);
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null);
  const [settleBillId, setSettleBillId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  async function loadBatches() {
    setBatchesLoading(true);
    try {
      const res = await fetch('/api/admin/billing/batches');
      setBatches(res.ok ? await res.json() : []);
    } finally {
      setBatchesLoading(false);
    }
  }

  async function loadStandalone() {
    setStandaloneLoading(true);
    try {
      const res = await fetch('/api/admin/billing/standalone');
      setStandaloneBills(res.ok ? await res.json() : []);
    } finally {
      setStandaloneLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
    loadStandalone();
  }, []);

  async function remindStandaloneBill(billId: string) {
    setRemindingId(billId);
    try {
      const res = await fetch(`/api/admin/billing/bills/${billId}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '提醒繳費失敗，請稍後再試');
        return;
      }
      showToast('已發送提醒繳費通知');
    } finally {
      setRemindingId(null);
    }
  }

  async function notifyStandaloneBill(billId: string) {
    if (!(await confirm('確定要通知這筆帳單的家長嗎？'))) return;
    setNotifyingId(billId);
    try {
      const res = await fetch('/api/admin/billing/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billIds: [billId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '通知失敗，請稍後再試');
        return;
      }
      showToast('已通知');
      await loadStandalone();
    } finally {
      setNotifyingId(null);
    }
  }

  const batchColumns: Column<BatchRow>[] = [
    { header: '種類', render: (r) => KIND_LABEL[r.kind] },
    {
      header: '收費區間',
      width: 'w-64',
      render: (r) => (
        <span className="whitespace-nowrap">
          {formatDateWithWeekday(r.periodStart)} ～ {formatDateWithWeekday(r.periodEnd)}
        </span>
      ),
      sortValue: (r) => r.periodStart,
    },
    { header: '狀態', render: (r) => <BatchStatusBadge status={r.status} /> },
    {
      header: '總應收',
      render: (r) => (r.totalDue === null ? '—' : `${r.totalDue.toLocaleString('en-US')} 元`),
      sortValue: (r) => r.totalDue,
    },
    {
      header: '已收',
      render: (r) => (r.totalPaid === null ? '—' : <span className="text-approved">{r.totalPaid.toLocaleString('en-US')} 元</span>),
    },
    {
      header: '未收',
      render: (r) =>
        r.totalOutstanding === null ? (
          '—'
        ) : (
          <span className={r.totalOutstanding > 0 ? 'font-semibold text-rejected' : ''}>
            {r.totalOutstanding.toLocaleString('en-US')} 元
          </span>
        ),
    },
  ];

  const standaloneColumns: Column<StandaloneBillRow>[] = [
    { header: '學生', render: (r) => r.student.user.name, sortValue: (r) => r.student.user.name },
    { header: '項目', render: (r) => r.class?.name ?? r.tutoringEnrollment?.program.name ?? '-' },
    {
      header: '區間',
      width: 'w-64',
      render: (r) => (
        <span className="whitespace-nowrap">
          {formatDateWithWeekday(r.periodStart)} ～ {formatDateWithWeekday(r.periodEnd)}
        </span>
      ),
      sortValue: (r) => r.periodStart,
    },
    { header: '應繳', render: (r) => `${r.amountDue.toLocaleString('en-US')} 元`, sortValue: (r) => r.amountDue },
    { header: '繳費狀態', render: (r) => <PaidStateBadge amountDue={r.amountDue} payments={r.payments} /> },
    {
      header: '通知',
      render: (r) =>
        r.notifiedAt ? (
          <span className="text-ink">已通知・{formatDateWithWeekday(r.notifiedAt)}</span>
        ) : (
          <span className="text-inkMuted">未通知</span>
        ),
      sortValue: (r) => r.notifiedAt,
    },
    {
      header: '操作',
      render: (r) => {
        const { state } = getPaidState(r.amountDue, r.payments);
        // 單一狀態驅動的通知類動作：未通知過＝通知；已通知過但未繳清＝提醒繳費；
        // 已通知且已繳清＝不放進選單。不是「按過」這種前端暫時狀態，是系統實際判定。
        const notifyItem: ActionMenuItem | null = !r.notifiedAt
          ? { key: 'notify', label: '通知', loading: notifyingId === r.id, onClick: () => notifyStandaloneBill(r.id) }
          : state !== 'PAID'
            ? { key: 'remind', label: '提醒繳費', loading: remindingId === r.id, onClick: () => remindStandaloneBill(r.id) }
            : null;
        return (
          <div className="flex justify-center">
            <ActionMenu
              items={[
                { key: 'payment', label: '繳款', onClick: () => setPaymentBillId(r.id) },
                ...(notifyItem ? [notifyItem] : []),
                ...(r.settledAsWithdrawal ? [] : [{ key: 'settle', label: '退班結算', onClick: () => setSettleBillId(r.id) }]),
              ]}
            />
          </div>
        );
      },
    },
  ];

  const standalonePaymentBill = standaloneBills.find((r) => r.id === paymentBillId) ?? null;
  const standaloneSettleBill = standaloneBills.find((r) => r.id === settleBillId) ?? null;

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">收費</h1>

      <div className="mb-4 flex gap-1 border-b border-borderSubtle">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`cursor-pointer whitespace-nowrap px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'border-b-2 border-brand text-brandDark' : 'text-inkMuted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'batches' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => setWizardOpen(true)}>＋ 開新批次</Button>
            <Button variant="secondary" onClick={() => setStandaloneModalOpen(true)}>
              單獨開單
            </Button>
          </div>

          <Card className="mb-6">
            <DataTable
              columns={batchColumns}
              rows={batches}
              keyField={(r) => r.id}
              onRowClick={(r) => router.push(`/admin/billing/${r.id}`)}
              rowClassName={() => 'cursor-pointer'}
              loading={batchesLoading}
              emptyText="目前沒有收費批次"
            />
          </Card>

          <h2 className="mb-2 font-bold text-ink">單獨開單帳單</h2>
          <Card>
            <CollapsibleDataTable
              columns={standaloneColumns}
              rows={standaloneBills}
              keyField={(r) => r.id}
              maxRows={3}
              loading={standaloneLoading}
              emptyText="目前沒有單獨開立的帳單"
              onRowClick={(r) => setExpandedStandaloneId((prev) => (prev === r.id ? null : r.id))}
              rowClassName={() => 'cursor-pointer'}
              expandedKey={expandedStandaloneId}
              renderExpanded={(r) => <BillDetailBlock detail={r.detail} />}
            />
          </Card>
        </>
      )}

      {tab === 'closedDays' && <ClosedDaysTab />}
      {tab === 'settings' && <SettingsTab />}

      <BatchWizardModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <StandaloneBillModal
        open={standaloneModalOpen}
        onClose={() => setStandaloneModalOpen(false)}
        onCreated={() => {
          setStandaloneModalOpen(false);
          loadStandalone();
        }}
      />
      <PaymentModal bill={standalonePaymentBill} onClose={() => setPaymentBillId(null)} onChanged={loadStandalone} />
      <SettleModal bill={standaloneSettleBill} onClose={() => setSettleBillId(null)} onChanged={loadStandalone} />
      {ConfirmDialog}
    </>
  );
}
