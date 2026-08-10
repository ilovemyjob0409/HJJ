'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import DataTable from '@/components/ui/DataTable';
import ExportCsvButton from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface OverviewRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: string;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
}

interface SummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  cancelledLate: number;
  absent: number;
  makeup: number;
}

function todayDateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminTutoringBookingsPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [date, setDate] = useState(todayDateInput());
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [month, setMonth] = useState(todayDateInput().slice(0, 7));
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  async function loadOverview() {
    const res = await fetch(`/api/tutoring-bookings/overview?date=${date}`);
    setRows(await res.json());
  }

  async function loadSummary() {
    const res = await fetch(`/api/tutoring-bookings/monthly-summary?month=${month}`);
    setSummary(await res.json());
  }

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function cancel(row: OverviewRow, countsTowardQuota: boolean) {
    const message = countsTowardQuota ? '確定要取消並計入這位學生本月次數嗎？' : '確定要取消嗎？此次不計入學生次數。';
    if (!(await confirm(message, { danger: true }))) return;
    await fetch(`/api/tutoring-bookings/${row.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countsTowardQuota }),
    });
    showToast('已取消');
    loadOverview();
  }

  const columns: Column<OverviewRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '時間', render: (r) => `${r.startTime}-${r.endTime}` },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
    {
      header: '操作',
      render: (r) =>
        r.status === 'BOOKED' ? (
          <div className="flex flex-col gap-1">
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r, false)}>
              取消（不計次）
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r, true)}>
              取消（計次）
            </Button>
          </div>
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
  ];

  const summaryColumns: Column<SummaryRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '已上', render: (r) => r.attended },
    { header: '當天取消', render: (r) => r.cancelledLate },
    { header: '缺席', render: (r) => r.absent },
    { header: '補課', render: (r) => r.makeup },
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

      <div className="mb-4 flex items-center gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <Card className="mb-6">
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} emptyText="這天沒有預約" />
      </Card>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-bold text-ink">當月出席總表</h2>
        <div className="flex items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <ExportCsvButton
            rows={summary}
            filename={`個別輔導出席總表_${month}`}
            columns={[
              { header: '學生', value: (r) => r.studentName },
              { header: '課程', value: (r) => r.programName },
              { header: '已上', value: (r) => r.attended },
              { header: '當天取消', value: (r) => r.cancelledLate },
              { header: '缺席', value: (r) => r.absent },
              { header: '補課', value: (r) => r.makeup },
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
