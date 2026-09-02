'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import CollapsibleSearchInput from '@/components/ui/CollapsibleSearchInput';
import ActionMenu, { ActionMenuItem } from '@/components/ui/ActionMenu';
import { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday, formatTimestampWithWeekdayTaipei } from '@/lib/dateFormat';
import { taipeiDateKey } from '@/lib/taipeiDate';
import PaymentModal from './PaymentModal';
import SettleModal from './SettleModal';
import BillDetailBlock, { BillDetailJson } from '@/components/BillDetailBlock';

interface OverviewBillRow {
  id: string;
  source: 'CLASS' | 'TUTORING' | null;
  batchId: string | null;
  studentName: string;
  targetName: string;
  periodStart: string;
  periodEnd: string;
  amountDue: number;
  paid: number;
  outstanding: number;
  state: 'UNPAID' | 'PARTIAL' | 'PAID';
  payments: { id: string; amount: number; paidOn: string; method: 'CASH' | 'TRANSFER'; note: string | null }[];
  notifiedAt: string | null;
  settledAsWithdrawal: boolean;
  classId: string | null;
  billedSessions: number | null;
  detail: BillDetailJson;
}

interface Overview {
  summary: { totalDue: number; totalPaid: number; totalOutstanding: number; count: number };
  bills: OverviewBillRow[];
}

const SOURCE_LABEL: Record<'CLASS' | 'TUTORING', string> = { CLASS: '圍棋班級批次', TUTORING: '英數個輔批次' };

// 來源篩選鈕：STANDALONE＝單獨開單（source 為 null 的帳單）
type SourceFilter = 'STANDALONE' | 'CLASS' | 'TUTORING';
const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'STANDALONE', label: '單獨開單' },
  { key: 'CLASS', label: '圍棋班級批次' },
  { key: 'TUTORING', label: '英數個輔批次' },
];

const ERROR_MESSAGES: Record<string, string> = {
  BILL_NOT_FINALIZED: '這筆帳單非已定案狀態，無法通知',
  ALREADY_PAID: '這筆帳單已繳清，不需提醒繳費',
  BILL_HAS_PAYMENTS: '這筆帳單已有繳款紀錄，請先處理繳款後再刪除',
  BILL_CREDITS_SESSIONS: '這筆班級帳單已把堂數計入學生總堂數，無法直接刪除，請聯絡工程處理',
};

// 與本頁批次明細頁的 PaidStateBadge 同一套配色；這裡 state 由 API 算好回傳，
// 不用再吃 amountDue/payments，所以另放一份映射（同繳費頁的取捨）。
const PAID_STATE_CONFIG: Record<'UNPAID' | 'PARTIAL' | 'PAID', { label: string; bg: string; text: string }> = {
  UNPAID: { label: '未繳', bg: 'bg-rejectedBg', text: 'text-rejected' },
  PARTIAL: { label: '部分繳', bg: 'bg-pendingBg', text: 'text-pending' },
  PAID: { label: '繳清', bg: 'bg-approvedBg', text: 'text-approved' },
};

// 「區間」鈕展開時預帶的區間：台北「今天」所在月份的 1 號～月底
function defaultRange(): { start: string; end: string } {
  const todayKey = taipeiDateKey(new Date());
  const [y, m] = todayKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = todayKey.slice(0, 8);
  return { start: `${prefix}01`, end: `${prefix}${String(lastDay).padStart(2, '0')}` };
}

export default function OverviewTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  // 預設不限區間（全部已定案帳單）；「區間」鈕展開才啟用日期篩選，收合即清除
  const [rangeOpen, setRangeOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Overview | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter | null>(null);
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null);
  const [settleBillId, setSettleBillId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const rangeInvalid = !!startDate && !!endDate && startDate > endDate;

  useEffect(() => {
    const hasRange = !!startDate && !!endDate;
    // 只填了一半或起訖顛倒時不查，畫面停在上一次結果；兩欄都空＝不限區間
    if ((startDate || endDate) && !hasRange) return;
    if (hasRange && startDate > endDate) return;
    let stale = false; // 日期快速連改時，只採用最後一次查詢的結果
    setLoading(true);
    fetch(hasRange ? `/api/admin/billing/overview?start=${startDate}&end=${endDate}` : '/api/admin/billing/overview')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!stale) setData(d);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [startDate, endDate, reloadKey, refreshKey]);

  const reload = () => setReloadKey((k) => k + 1);

  async function remindBill(billId: string) {
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

  async function notifyBill(billId: string) {
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
      reload();
    } finally {
      setNotifyingId(null);
    }
  }

  async function deleteBill(billId: string) {
    if (!(await confirm('確定要刪除這筆帳單嗎？此動作無法復原。', { danger: true }))) return;
    setDeletingId(billId);
    try {
      const res = await fetch(`/api/admin/billing/bills/${billId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '刪除失敗，請稍後再試');
        return;
      }
      showToast('已刪除帳單');
      reload();
    } finally {
      setDeletingId(null);
    }
  }

  const columns: Column<OverviewBillRow>[] = [
    {
      header: '來源',
      render: (r) => (r.source ? SOURCE_LABEL[r.source] : '單獨開單'),
      sortValue: (r) => (r.source ? SOURCE_LABEL[r.source] : '單獨開單'),
    },
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    { header: '項目', render: (r) => r.targetName, sortValue: (r) => r.targetName },
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
    { header: '應繳', render: (r) => `${r.amountDue.toLocaleString('en-US')} 元`, sortValue: (r) => r.amountDue },
    {
      header: '繳費狀態',
      render: (r) => {
        const { label, bg, text } = PAID_STATE_CONFIG[r.state];
        return <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
      },
      sortValue: (r) => r.state,
    },
    {
      header: '通知',
      render: (r) =>
        r.notifiedAt ? (
          <span className="text-ink">已通知・{formatTimestampWithWeekdayTaipei(r.notifiedAt)}</span>
        ) : (
          <span className="text-inkMuted">未通知</span>
        ),
      sortValue: (r) => r.notifiedAt,
    },
    {
      header: '操作',
      render: (r) => {
        // 單一狀態驅動的通知類動作：未通知過＝通知；已通知過但未繳清＝提醒繳費；
        // 已通知且已繳清＝不放進選單。與主頁單獨開單帳單表同一套規則。
        const notifyItem: ActionMenuItem | null = !r.notifiedAt
          ? { key: 'notify', label: '通知', loading: notifyingId === r.id, onClick: () => notifyBill(r.id) }
          : r.state !== 'PAID'
            ? { key: 'remind', label: '提醒繳費', loading: remindingId === r.id, onClick: () => remindBill(r.id) }
            : null;
        // 刪除鈕預先擋掉班級帳單已充值堂數的情況（跟服務層的 BILL_CREDITS_SESSIONS
        // 是同一條規則，這裡先隱藏選項給更直接的引導；已有繳款的情況沒有預先擋，
        // 讓伺服器的 BILL_HAS_PAYMENTS 錯誤訊息說明原因即可）。
        const canDelete = !(r.classId && (r.billedSessions ?? 0) > 0);
        return (
          <div className="flex justify-center">
            <ActionMenu
              items={[
                { key: 'payment', label: '繳款', onClick: () => setPaymentBillId(r.id) },
                ...(notifyItem ? [notifyItem] : []),
                ...(r.settledAsWithdrawal ? [] : [{ key: 'settle', label: '退班結算', onClick: () => setSettleBillId(r.id) }]),
                ...(r.batchId
                  ? [{ key: 'batch', label: '查看批次', onClick: () => router.push(`/admin/billing/${r.batchId}`) }]
                  : []),
                ...(canDelete
                  ? [{ key: 'delete', label: '刪除帳單', tone: 'danger' as const, loading: deletingId === r.id, onClick: () => deleteBill(r.id) }]
                  : []),
              ]}
            />
          </div>
        );
      },
    },
  ];

  const query = search.trim().toLowerCase();
  const filteredBills = (data?.bills ?? []).filter((r) => {
    if (sourceFilter === 'STANDALONE' && r.source !== null) return false;
    if ((sourceFilter === 'CLASS' || sourceFilter === 'TUTORING') && r.source !== sourceFilter) return false;
    if (query && !r.studentName.toLowerCase().includes(query) && !r.targetName.toLowerCase().includes(query)) return false;
    return true;
  });
  const isFiltered = sourceFilter !== null || query !== '';

  // 統計卡跟著畫面上的清單連動：來源篩選／搜尋／區間都會影響，
  // 所以不用 API 回的整體 summary，直接由篩選後的列即時加總
  const summary = data
    ? {
        totalDue: filteredBills.reduce((s, r) => s + r.amountDue, 0),
        totalPaid: filteredBills.reduce((s, r) => s + r.paid, 0),
        totalOutstanding: filteredBills.reduce((s, r) => s + r.outstanding, 0),
        count: filteredBills.length,
      }
    : null;
  const stats: { label: string; value: number | null; className: string; sub?: string }[] = [
    { label: '總應收', value: summary?.totalDue ?? null, className: 'text-ink', sub: summary ? `共 ${summary.count} 筆` : undefined },
    { label: '已收', value: summary?.totalPaid ?? null, className: 'text-approved' },
    { label: '未收', value: summary?.totalOutstanding ?? null, className: 'text-rejected' },
  ];

  const paymentBill = data?.bills.find((r) => r.id === paymentBillId) ?? null;
  const settleBill = data?.bills.find((r) => r.id === settleBillId) ?? null;

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-sm text-inkMuted">{s.label}</p>
            {loading ? (
              <div className="skeleton-shimmer mt-2 h-8 w-28 rounded" />
            ) : (
              <p className={`mt-1 text-2xl font-bold ${s.className}`}>
                {s.value === null ? '—' : `${s.value.toLocaleString('en-US')} 元`}
              </p>
            )}
            {!loading && s.sub && <p className="mt-0.5 text-xs text-inkMuted">{s.sub}</p>}
          </Card>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 whitespace-nowrap font-bold text-ink">收費清單</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {SOURCE_FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={sourceFilter === f.key ? 'primary' : 'secondary'}
              className="px-3 py-1 text-xs"
              onClick={() => setSourceFilter((prev) => (prev === f.key ? null : f.key))}
            >
              {f.label}
            </Button>
          ))}
          {/* 刻意不用 Button 的灰底 secondary 樣式：區間是「日期篩選」開關，
              跟左邊三顆來源篩選鈕不同類，用金色系（brandDark）做視覺區隔 */}
          <button
            type="button"
            aria-expanded={rangeOpen}
            className={`inline-flex items-center justify-center rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
              rangeOpen
                ? 'border-brandDark bg-brandDark text-brandInk'
                : 'border-brandDark/50 text-brandDark hover:bg-brandDark/10'
            }`}
            onClick={() => {
              if (rangeOpen) {
                // 收合＝清除區間，回到不限期間（同放大鏡收合清空搜尋的慣例）
                setRangeOpen(false);
                setStartDate('');
                setEndDate('');
              } else {
                // 展開時預帶本月，一鍵回到「當月」視角，仍可手改
                const d = defaultRange();
                setRangeOpen(true);
                setStartDate(d.start);
                setEndDate(d.end);
              }
            }}
          >
            區間
          </button>
        </div>
        <CollapsibleSearchInput placeholder="搜尋學生或項目" value={search} onChange={setSearch} />
      </div>
      {rangeOpen && (
        <div className="animate-rise-in mb-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            區間起
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            區間訖
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          {rangeInvalid && <p className="pb-2 text-xs text-rejected">起日不能晚於訖日</p>}
        </div>
      )}
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={filteredBills}
          keyField={(r) => r.id}
          maxRows={3}
          loading={loading}
          emptyText={
            isFiltered ? '沒有符合篩選的帳單' : rangeOpen ? '這段區間內沒有已定案的帳單' : '目前沒有已定案的帳單'
          }
          onRowClick={(r) => setExpandedBillId((prev) => (prev === r.id ? null : r.id))}
          rowClassName={() => 'cursor-pointer'}
          expandedKey={expandedBillId}
          renderExpanded={(r) => <BillDetailBlock detail={r.detail} />}
        />
      </Card>

      <PaymentModal bill={paymentBill} onClose={() => setPaymentBillId(null)} onChanged={reload} />
      <SettleModal bill={settleBill} onClose={() => setSettleBillId(null)} onChanged={reload} />
      {ConfirmDialog}
    </>
  );
}
