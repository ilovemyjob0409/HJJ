'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';

interface PendingRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  leaveRequest: { student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  targetDate: string | null;
  teacher: { user: { name: string } } | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

export default function AdminMakeupRequestsPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<PendingRow[]>([]);

  async function load() {
    const res = await fetch('/api/makeup-requests/pending');
    setRows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    await fetch(`/api/makeup-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
    showToast(decision === 'APPROVED' ? '已核准' : '已拒絕');
    load();
  }

  const columns: Column<PendingRow>[] = [
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    { header: '原班級', render: (r) => r.leaveRequest.class.name },
    { header: '類型', render: (r) => (r.type === 'INSERTION' ? '插班' : '一對一') },
    {
      header: '目標',
      render: (r) =>
        r.type === 'INSERTION'
          ? `${r.targetClass?.name} @ ${r.targetDate ? new Date(r.targetDate).toLocaleDateString() : ''}`
          : `${r.teacher?.user.name} @ ${r.slotDate ? new Date(r.slotDate).toLocaleDateString() : ''} ${r.slotStartTime}-${r.slotEndTime}`,
    },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ADMIN" /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button className="px-3 py-1 text-xs" onClick={() => decide(r.id, 'APPROVED')}>
            核准
          </Button>
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => decide(r.id, 'REJECTED')}>
            拒絕
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">待確認補課申請</h1>
      <Card>
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} />
      </Card>
    </AppShell>
  );
}
