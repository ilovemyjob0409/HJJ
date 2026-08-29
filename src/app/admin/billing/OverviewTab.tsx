'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { taipeiDateKey } from '@/lib/taipeiDate';

interface OverviewBillRow {
  id: string;
  source: 'CLASS' | 'TUTORING' | null;
  studentName: string;
  targetName: string;
  periodStart: string;
  periodEnd: string;
  amountDue: number;
  paid: number;
  outstanding: number;
  state: 'UNPAID' | 'PARTIAL' | 'PAID';
}

interface Overview {
  summary: { totalDue: number; totalPaid: number; totalOutstanding: number; count: number };
  bills: OverviewBillRow[];
}

const SOURCE_LABEL: Record<'CLASS' | 'TUTORING', string> = { CLASS: '圍棋班級批次', TUTORING: '英數個輔批次' };

// 與本頁批次分頁的 PaidStateBadge 同一套配色；這裡 state 由 API 算好回傳，
// 不用再吃 amountDue/payments，所以另放一份映射（同繳費頁的取捨）。
const PAID_STATE_CONFIG: Record<'UNPAID' | 'PARTIAL' | 'PAID', { label: string; bg: string; text: string }> = {
  UNPAID: { label: '未繳', bg: 'bg-rejectedBg', text: 'text-rejected' },
  PARTIAL: { label: '部分繳', bg: 'bg-pendingBg', text: 'text-pending' },
  PAID: { label: '繳清', bg: 'bg-approvedBg', text: 'text-approved' },
};

// 預設區間：台北「今天」所在月份的 1 號～月底
function defaultRange(): { start: string; end: string } {
  const todayKey = taipeiDateKey(new Date());
  const [y, m] = todayKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = todayKey.slice(0, 8);
  return { start: `${prefix}01`, end: `${prefix}${String(lastDay).padStart(2, '0')}` };
}

export default function OverviewTab() {
  const [startDate, setStartDate] = useState(() => defaultRange().start);
  const [endDate, setEndDate] = useState(() => defaultRange().end);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Overview | null>(null);

  const rangeInvalid = !!startDate && !!endDate && startDate > endDate;

  useEffect(() => {
    if (!startDate || !endDate || startDate > endDate) return;
    let stale = false; // 日期快速連改時，只採用最後一次查詢的結果
    setLoading(true);
    fetch(`/api/admin/billing/overview?start=${startDate}&end=${endDate}`)
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
  }, [startDate, endDate]);

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
  ];

  const summary = data?.summary ?? null;
  const stats: { label: string; value: number | null; className: string; sub?: string }[] = [
    { label: '總應收', value: summary?.totalDue ?? null, className: 'text-ink', sub: summary ? `共 ${summary.count} 筆` : undefined },
    { label: '已收', value: summary?.totalPaid ?? null, className: 'text-approved' },
    { label: '未收', value: summary?.totalOutstanding ?? null, className: 'text-rejected' },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
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

      <h2 className="mb-2 font-bold text-ink">區間內帳單</h2>
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={data?.bills ?? []}
          keyField={(r) => r.id}
          maxRows={3}
          loading={loading}
          emptyText="這段區間內沒有已定案的帳單"
        />
      </Card>
    </>
  );
}
