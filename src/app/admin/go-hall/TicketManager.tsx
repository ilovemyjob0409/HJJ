'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export const QUALIFICATION_LABEL: Record<string, string> = {
  SEASON_PASS: '季票',
  TICKET: '堂票',
  SINGLE: '單堂（現場收費）',
};

const KIND_LABELS: Record<string, string> = {
  PURCHASE: '購買',
  ATTEND: '到場扣堂',
  ADMIN_ADJUST: '調整',
};

interface SummaryRow {
  id: string;
  name: string;
  studentNumber: string | null;
  balance: number;
  activePassEndDate: string | null;
}

interface SeasonPassRow {
  id: string;
  startDate: string;
  endDate: string;
}

interface HistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string | null;
  createdAt: string;
  sessionDate: string | null;
}

interface TicketDetail {
  balance: number;
  seasonPasses: SeasonPassRow[];
  history: HistoryRow[];
}

export default function TicketManager() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [managing, setManaging] = useState<SummaryRow | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const [purchaseSessions, setPurchaseSessions] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [passStart, setPassStart] = useState('');
  const [passEnd, setPassEnd] = useState('');

  async function loadSummaries() {
    try {
      const res = await fetch('/api/go-hall-tickets/summary');
      if (res.ok) setSummaries(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummaries();
  }, []);

  async function openManage(row: SummaryRow) {
    setManaging(row);
    setDetail(null);
    setPurchaseSessions('');
    setAdjustAmount('');
    setAdjustReason('');
    setPassStart('');
    setPassEnd('');
    const res = await fetch(`/api/go-hall-tickets/${row.id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function refreshAfterMutation() {
    if (!managing) return;
    const res = await fetch(`/api/go-hall-tickets/${managing.id}`);
    if (res.ok) setDetail(await res.json());
    loadSummaries();
  }

  async function submit(url: string, body: unknown, successText: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json();
        const messages: Record<string, string> = {
          INVALID_AMOUNT: '數量必須是不為零的整數（購買至少 1 堂）',
          INSUFFICIENT_TICKETS: '調整後餘額不能為負',
          REASON_REQUIRED: '請填寫原因',
          INVALID_RANGE: '結束日不能早於開始日',
        };
        showToast(messages[data.error] ?? `錯誤：${data.error}`);
        return;
      }
      showToast(successText);
      await refreshAfterMutation();
    } finally {
      setBusy(false);
    }
  }

  async function handlePurchase() {
    if (!managing) return;
    await submit('/api/go-hall-tickets/purchase', { studentId: managing.id, sessions: Number(purchaseSessions) }, '已登記購買');
    setPurchaseSessions('');
  }

  async function handleAdjust() {
    if (!managing) return;
    await submit('/api/go-hall-tickets/adjust', { studentId: managing.id, amount: Number(adjustAmount), reason: adjustReason }, '已調整');
    setAdjustAmount('');
    setAdjustReason('');
  }

  async function handleAddPass() {
    if (!managing) return;
    await submit('/api/go-hall-season-passes', { studentId: managing.id, startDate: passStart, endDate: passEnd }, '已新增季票');
    setPassStart('');
    setPassEnd('');
  }

  async function handleDeletePass(id: string) {
    if (!(await confirm('確定要刪除這筆季票嗎？', { danger: true }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/go-hall-season-passes/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('刪除失敗，季票可能已被刪除');
        await refreshAfterMutation();
        return;
      }
      showToast('已刪除季票');
      await refreshAfterMutation();
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter((s) => s.name.toLowerCase().includes(q) || (s.studentNumber ?? '').toLowerCase().includes(q));
  }, [summaries, search]);

  const columns: Column<SummaryRow>[] = [
    { header: '姓名', render: (s) => s.name, sortValue: (s) => s.name },
    { header: '學號', render: (s) => s.studentNumber ?? '-', sortValue: (s) => s.studentNumber ?? null },
    {
      header: '堂票剩餘',
      render: (s) => (
        <span className="tabular-nums">
          <span className="font-semibold text-ink">{s.balance}</span> 堂
        </span>
      ),
      sortValue: (s) => s.balance,
    },
    {
      header: '季票',
      render: (s) =>
        s.activePassEndDate ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="rounded-full bg-approvedBg px-2 py-0.5 text-xs font-semibold text-approved">使用中</span>
            <span className="text-xs text-inkMuted">至 {formatDateWithWeekday(s.activePassEndDate, 'zh-TW')}</span>
          </span>
        ) : (
          '-'
        ),
      sortValue: (s) => s.activePassEndDate ?? null,
    },
    {
      header: '操作',
      render: (s) => (
        <Button className="px-3 py-1 text-xs" onClick={() => openManage(s)}>
          管理
        </Button>
      ),
    },
  ];

  const historyColumns: Column<HistoryRow>[] = [
    { header: '日期', render: (h) => formatDateWithWeekday(h.createdAt, 'zh-TW'), sortValue: (h) => h.createdAt },
    { header: '類型', render: (h) => KIND_LABELS[h.kind] ?? h.kind, sortValue: (h) => h.kind },
    {
      header: '堂數',
      render: (h) => (h.amount > 0 ? `+${h.amount}` : `${h.amount}`),
      sortValue: (h) => h.amount,
    },
    {
      header: '備註',
      render: (h) => h.reason ?? (h.sessionDate ? `場次 ${formatDateWithWeekday(h.sessionDate, 'zh-TW')}` : '-'),
    },
  ];

  const historyExportColumns = [
    { header: '日期', value: (h: HistoryRow) => formatDateWithWeekday(h.createdAt, 'zh-TW') },
    { header: '類型', value: (h: HistoryRow) => KIND_LABELS[h.kind] ?? h.kind },
    { header: '堂數', value: (h: HistoryRow) => (h.amount > 0 ? `+${h.amount}` : `${h.amount}`) },
    {
      header: '備註',
      value: (h: HistoryRow) => h.reason ?? (h.sessionDate ? `場次 ${formatDateWithWeekday(h.sessionDate, 'zh-TW')}` : ''),
    },
  ];

  return (
    <>
      <h2 className="mb-2 font-bold text-ink">票券管理</h2>
      <Card className="mb-6">
        <div className="mb-3">
          <Input placeholder="搜尋姓名或學號" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        </div>
        <DataTable columns={columns} rows={filtered} keyField={(s) => s.id} loading={loading} emptyText="找不到符合的學生" />
      </Card>

      <Modal open={managing !== null} onClose={() => setManaging(null)} title={managing ? `票券管理 - ${managing.name}` : ''} maxWidthClassName="max-w-2xl">
        {managing && (
          <div className="flex flex-col gap-4">
            {detail === null ? (
              <div className="flex flex-col gap-2">
                <div className="skeleton-shimmer h-4 w-40 rounded" />
                <div className="skeleton-shimmer h-4 w-56 rounded" />
              </div>
            ) : (
              <>
                <p className="text-sm text-ink">
                  堂票剩餘 <span className="font-bold">{detail.balance}</span> 堂
                </p>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-inkMuted">
                    購買堂數
                    <Input type="number" min={1} value={purchaseSessions} onChange={(e) => setPurchaseSessions(e.target.value)} className="w-24" />
                  </label>
                  <Button onClick={handlePurchase} loading={busy} disabled={!purchaseSessions}>
                    登記購買
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-inkMuted">
                    調整（可負）
                    <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className="w-24" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-inkMuted">
                    原因
                    <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-40" />
                  </label>
                  <Button onClick={handleAdjust} loading={busy} disabled={!adjustAmount || !adjustReason.trim()}>
                    調整
                  </Button>
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-ink">季票</h3>
                  {detail.seasonPasses.length === 0 ? (
                    <p className="text-sm text-inkMuted">尚無季票</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {detail.seasonPasses.map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-sm text-ink">
                          <span>
                            {formatDateWithWeekday(p.startDate, 'zh-TW')} ～ {formatDateWithWeekday(p.endDate, 'zh-TW')}
                          </span>
                          <button type="button" className="text-rejected hover:underline" onClick={() => handleDeletePass(p.id)} disabled={busy}>
                            刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs text-inkMuted">
                      開始日
                      <Input type="date" value={passStart} onChange={(e) => setPassStart(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-inkMuted">
                      結束日
                      <Input type="date" value={passEnd} onChange={(e) => setPassEnd(e.target.value)} />
                    </label>
                    <Button onClick={handleAddPass} loading={busy} disabled={!passStart || !passEnd}>
                      新增季票
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold text-ink">異動紀錄</h3>
                    <ExportExcelButton
                      rows={detail.history}
                      columns={historyExportColumns}
                      filename={`${managing.name}_弈廳異動紀錄`}
                      className="ml-auto shrink-0"
                    />
                  </div>
                  <CollapsibleDataTable
                    columns={historyColumns}
                    rows={detail.history}
                    keyField={(h) => h.id}
                    maxRows={3}
                    emptyText="尚無異動紀錄"
                  />
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
