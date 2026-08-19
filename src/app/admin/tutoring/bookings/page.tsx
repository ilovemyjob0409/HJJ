'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import DataTable from '@/components/ui/DataTable';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { WEEKDAY_LABELS, formatDateWithWeekday, isTodayTaipei } from '@/lib/dateFormat';

interface OverviewRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
}

interface SummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  absent: number;
}

interface DailyCount {
  date: string;
  booked: number;
  pending: number;
}

function todayDateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function AdminTutoringBookingsPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  // 月曆總覽的月份與逐日人數；點日期後在彈窗載入該日名單
  const [calMonth, setCalMonth] = useState(todayDateInput().slice(0, 7));
  const [counts, setCounts] = useState<DailyCount[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [month, setMonth] = useState(todayDateInput().slice(0, 7));
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  async function loadCounts() {
    const res = await fetch(`/api/tutoring-bookings/overview?month=${calMonth}`);
    setCounts(await res.json());
  }

  async function loadDay(date: string) {
    setRows([]);
    const res = await fetch(`/api/tutoring-bookings/overview?date=${date}`);
    setRows(await res.json());
  }

  async function loadSummary() {
    const res = await fetch(`/api/tutoring-bookings/monthly-summary?month=${month}`);
    setSummary(await res.json());
  }

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calMonth]);

  useEffect(() => {
    if (selectedDate) loadDay(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // 收費規範：取消一律不計次（扣堂只看有無到場），沒有「計次取消」。
  async function cancel(row: OverviewRow) {
    if (!(await confirm('確定要取消這筆預約嗎？（不扣堂）', { danger: true }))) return;
    await fetch(`/api/tutoring-bookings/${row.id}`, { method: 'DELETE' });
    showToast('已取消');
    if (selectedDate) loadDay(selectedDate);
    loadCounts();
  }

  const columns: Column<OverviewRow>[] = [
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般'), sortValue: (r) => r.kind },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    {
      header: '操作',
      render: (r) =>
        r.status === 'BOOKED' ? (
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r)}>
            取消
          </Button>
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
  ];

  const summaryColumns: Column<SummaryRow>[] = [
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    { header: '已上', render: (r) => r.attended, sortValue: (r) => r.attended },
    { header: '缺席', render: (r) => r.absent, sortValue: (r) => r.absent },
  ];

  return (
    <>
      <Link
        href="/admin/tutoring"
        className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回個別輔導管理
      </Link>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約總覽</h1>

      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <Button variant="secondary" className="px-2 py-1 text-sm" onClick={() => setCalMonth(shiftMonth(calMonth, -1))}>
            ‹ 上個月
          </Button>
          <p className="font-semibold text-ink">
            {Number(calMonth.slice(0, 4))}年{Number(calMonth.slice(5, 7))}月
          </p>
          <Button variant="secondary" className="px-2 py-1 text-sm" onClick={() => setCalMonth(shiftMonth(calMonth, 1))}>
            下個月 ›
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-inkMuted">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {(() => {
            const [y, m] = calMonth.split('-').map(Number);
            const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
            const leadingBlanks = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
            const countsByDate = new Map(counts.map((c) => [c.date, c]));
            return [
              ...Array.from({ length: leadingBlanks }).map((_, i) => <span key={`blank-${i}`} />),
              ...Array.from({ length: daysInMonth }).map((_, i) => {
                const dateKey = `${calMonth}-${String(i + 1).padStart(2, '0')}`;
                const count = countsByDate.get(dateKey);
                const hasAny = !!count && count.booked + count.pending > 0;
                const today = isTodayTaipei(dateKey);
                return (
                  <button
                    key={dateKey}
                    disabled={!hasAny}
                    onClick={() => setSelectedDate(dateKey)}
                    className={`flex min-h-16 flex-col items-center justify-start rounded-lg py-1.5 text-sm transition-colors ${
                      hasAny ? 'bg-approvedBg font-semibold text-approved hover:brightness-95' : 'text-inkMuted opacity-60'
                    } ${today ? 'ring-2 ring-brand' : ''}`}
                  >
                    <span>{i + 1}</span>
                    {count && count.booked > 0 && <span className="text-[10px] font-normal text-inkMuted">預約{count.booked}人</span>}
                  </button>
                );
              }),
            ];
          })()}
        </div>
        <p className="mt-2 text-xs text-inkMuted">點有預約的日期查看名單。</p>
      </Card>

      <Modal open={selectedDate !== null} onClose={() => setSelectedDate(null)} title={selectedDate ? `${formatDateWithWeekday(selectedDate)} 名單` : ''}>
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} emptyText="這天沒有預約" />
      </Modal>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-bold text-ink">當月出席總表</h2>
        <div className="flex items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <ExportExcelButton
            rows={summary}
            filename={`個別輔導出席總表_${month}`}
            columns={[
              { header: '學生', value: (r) => r.studentName },
              { header: '課程', value: (r) => r.programName },
              { header: '已上', value: (r) => r.attended },
              { header: '缺席', value: (r) => r.absent },
            ]}
          />
        </div>
      </div>
      <Card>
        <DataTable columns={summaryColumns} rows={summary} keyField={(r) => r.enrollmentId} emptyText="這個月沒有資料" />
      </Card>
      {ConfirmDialog}
    </>
  );
}
