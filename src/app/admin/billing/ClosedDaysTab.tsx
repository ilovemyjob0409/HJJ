'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import AlertModal from '@/components/ui/AlertModal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { taipeiDateKey } from '@/lib/taipeiDate';

interface ClosedDayRow {
  id: string;
  date: string;
  name: string;
  source: 'NATIONAL' | 'CUSTOM';
}

const SOURCE_LABEL: Record<ClosedDayRow['source'], string> = { NATIONAL: '國定假日', CUSTOM: '自訂' };

// 停課日曆是 CRUD 管理清單，不是紀錄類——刻意用一般 DataTable，
// 不套本站「表格 >3 筆預設收合」慣例（那條慣例只適用紀錄類清單）。
export default function ClosedDaysTab() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState<ClosedDayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [duplicateAlertOpen, setDuplicateAlertOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/billing/closed-days');
      setRows(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addClosedDay() {
    if (!newDate || !newName.trim()) {
      showToast('請填寫日期與名稱');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/billing/closed-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate, name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'DUPLICATE_DATE') {
          setDuplicateAlertOpen(true);
        } else {
          showToast('新增失敗，請稍後再試');
        }
        return;
      }
      setNewDate('');
      setNewName('');
      showToast('已新增停課日');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function removeRow(row: ClosedDayRow) {
    if (!(await confirm('刪除後該日照常上課並計費，確定？', { danger: true }))) return;
    const res = await fetch(`/api/admin/billing/closed-days/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，請稍後再試');
      return;
    }
    showToast('已刪除');
    load();
  }

  // date 是 API 回傳的 UTC 日曆日 ISO 字串（如 "2026-09-25T00:00:00.000Z"），
  // 前 10 碼即為日曆日 key，可直接跟台北「今天」字串比較（ISO 格式可字典序比較）。
  const todayKey = taipeiDateKey(new Date());
  const displayRows = showPast ? rows : rows.filter((r) => r.date.slice(0, 10) >= todayKey);

  const columns: Column<ClosedDayRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    { header: '名稱', render: (r) => r.name, sortValue: (r) => r.name },
    { header: '來源', render: (r) => SOURCE_LABEL[r.source], sortValue: (r) => r.source },
    {
      header: '刪除',
      render: (r) => (
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => removeRow(r)}>
          刪除
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card className="mb-4">
        <p className="mb-2 font-semibold text-ink">新增停課日</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-inkMuted">
            日期
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1 block" />
          </label>
          <label className="text-xs text-inkMuted">
            名稱
            <Input
              placeholder="例如：颱風假"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 block"
            />
          </label>
          <Button onClick={addClosedDay} loading={submitting}>
            新增停課日
          </Button>
        </div>
      </Card>

      <div className="mb-2 flex items-center justify-end">
        <label className="flex items-center gap-1.5 text-xs text-inkMuted">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          顯示過去
        </label>
      </div>

      <Card>
        <DataTable
          columns={columns}
          rows={displayRows}
          keyField={(r) => r.id}
          loading={loading}
          emptyText={showPast ? '目前沒有停課日' : '今天以後沒有停課日'}
        />
      </Card>

      <AlertModal open={duplicateAlertOpen} onClose={() => setDuplicateAlertOpen(false)} title="日期重複">
        該日期已在停課日曆中
      </AlertModal>
      {ConfirmDialog}
    </>
  );
}
