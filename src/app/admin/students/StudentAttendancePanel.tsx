'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import AlertModal from '@/components/ui/AlertModal';
import StatusBadge from '@/components/ui/StatusBadge';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { normalizeTimeInput, isValidTimeValue } from '@/lib/timeFormat';

interface AttendanceRow {
  id: string;
  type: 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY' | 'TUTORING';
  date: string;
  title: string;
  status: string; // AttendanceStatus | 'NO_SHOW'
  checkInTime: string | null;
  checkOutTime: string | null;
  classId?: string;
  makeupRequestId?: string;
  sessionId?: string;
  activityId?: string;
  windowId?: string;
  bookingId?: string;
}

interface BackfillGroup {
  classId: string;
  className: string;
  dates: string[];
}

const TYPE_LABELS: Record<AttendanceRow['type'], string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
  TUTORING: '個別輔導',
};

// 狀態選項照點名選項精簡慣例：班級才有請假/缺席/未報名，其他只有未點名/出席
const STATUS_OPTIONS: Record<AttendanceRow['type'], { value: string; label: string }[]> = {
  CLASS: [
    { value: 'NONE', label: '未點名' },
    { value: 'PRESENT', label: '出席' },
    { value: 'ON_LEAVE', label: '請假' },
    { value: 'ABSENT', label: '缺席' },
    { value: 'NOT_REGISTERED', label: '未報名' },
  ],
  ONE_ON_ONE: [
    { value: 'NONE', label: '未點名' },
    { value: 'PRESENT', label: '出席' },
  ],
  GO_HALL: [
    { value: 'NONE', label: '未點名' },
    { value: 'PRESENT', label: '出席' },
  ],
  ACTIVITY: [
    { value: 'NONE', label: '未點名' },
    { value: 'PRESENT', label: '出席' },
  ],
  TUTORING: [
    { value: 'NONE', label: '未點名' },
    { value: 'PRESENT', label: '出席' },
  ],
};

// 學生管理列展開的「出缺勤」面板：五類紀錄合併清單（逐筆可編輯補簽）
// ＋「補簽到」勾選班級上課日批量補出席。
export default function StudentAttendancePanel({ studentId }: { studentId: string }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [backfill, setBackfill] = useState<BackfillGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<AttendanceRow | null>(null);
  const [editStatus, setEditStatus] = useState('NONE');
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [saving, setSaving] = useState(false);

  const [backfillOpen, setBackfillOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set()); // `${classId}|${date}`
  const [backfilling, setBackfilling] = useState(false);

  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/students/${studentId}/attendance`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
        setBackfill(data.backfill);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  function openEdit(row: AttendanceRow) {
    setEditing(row);
    setEditStatus(row.status === 'NO_SHOW' ? 'NONE' : row.status);
    setEditIn(row.checkInTime ?? '');
    setEditOut(row.checkOutTime ?? '');
  }

  async function handleSave() {
    if (!editing) return;
    const inTime = editIn.trim() === '' ? null : normalizeTimeInput(editIn);
    const outTime = editOut.trim() === '' ? null : normalizeTimeInput(editOut);
    if ((inTime !== null && !isValidTimeValue(inTime)) || (outTime !== null && !isValidTimeValue(outTime))) {
      setAlertMsg('時間格式不正確，請輸入 24 小時制 4 位數字（例如 1405）。');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/attendance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: editing.type,
          date: editing.date,
          status: editStatus,
          checkInTime: inTime,
          checkOutTime: outTime,
          classId: editing.classId,
          makeupRequestId: editing.makeupRequestId,
          sessionId: editing.sessionId,
          activityId: editing.activityId,
          windowId: editing.windowId,
          bookingId: editing.bookingId,
        }),
      });
      if (!res.ok) {
        setAlertMsg('儲存失敗，請稍後再試。');
        return;
      }
      showToast('已更新出缺勤');
      setEditing(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  function toggleChecked(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleBackfill() {
    const items = Array.from(checked).map((key) => {
      const [classId, date] = key.split('|');
      return { classId, date };
    });
    if (items.length === 0) return;
    setBackfilling(true);
    try {
      const res = await fetch(`/api/students/${studentId}/attendance/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        setAlertMsg('補簽到失敗，請稍後再試。');
        return;
      }
      const { created, skipped } = await res.json();
      showToast(skipped > 0 ? `已補簽 ${created} 筆（${skipped} 筆已有紀錄略過）` : `已補簽 ${created} 筆`);
      setBackfillOpen(false);
      setChecked(new Set());
      load();
    } finally {
      setBackfilling(false);
    }
  }

  const columns: Column<AttendanceRow>[] = [
    { header: '日期', render: (r) => <span className="whitespace-nowrap">{formatDateWithWeekday(r.date)}</span>, sortValue: (r) => r.date },
    { header: '類型', render: (r) => TYPE_LABELS[r.type], sortValue: (r) => TYPE_LABELS[r.type] },
    { header: '名稱', render: (r) => r.title, sortValue: (r) => r.title },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    { header: '簽到', render: (r) => r.checkInTime ?? '—' },
    { header: '簽退', render: (r) => r.checkOutTime ?? '—' },
    {
      header: '操作',
      render: (r) => (
        <Button variant="link" className="text-xs" onClick={() => openEdit(r)}>
          編輯
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-inkMuted">出缺勤紀錄</h3>
        <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setBackfillOpen(true)}>
          補簽到
        </Button>
      </div>

      <CollapsibleDataTable
        columns={columns}
        rows={rows}
        keyField={(r) => r.id}
        loading={loading}
        maxRows={3}
        emptyText="尚無出缺勤紀錄"
      />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯出缺勤">
        {editing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {formatDateWithWeekday(editing.date)}・{TYPE_LABELS[editing.type]}・{editing.title}
            </p>
            <label className="flex flex-col gap-1 text-sm text-ink">
              狀態
              <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                {STATUS_OPTIONS[editing.type].map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink">
                簽到時間
                <Input value={editIn} onChange={(e) => setEditIn(e.target.value)} placeholder="例如 1405" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                簽退時間
                <Input value={editOut} onChange={(e) => setEditOut(e.target.value)} placeholder="例如 1600" />
              </label>
            </div>
            <Button loading={saving} onClick={handleSave}>
              儲存
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={backfillOpen} onClose={() => setBackfillOpen(false)} title="補簽到">
        <div className="flex flex-col gap-3">
          {backfill.length === 0 ? (
            <p className="text-sm text-inkMuted">近兩個月沒有可補簽的班級上課日（未點名的日子才能補）。</p>
          ) : (
            <>
              <p className="text-sm text-inkMuted">勾選要補簽的上課日，將一律補為「出席」（不帶簽到時間）。</p>
              {backfill.map((g) => (
                <div key={g.classId} className="rounded-lg border border-borderSubtle p-3">
                  <p className="mb-2 text-sm font-semibold text-ink">{g.className}</p>
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {g.dates.map((d) => {
                      const key = `${g.classId}|${d}`;
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm text-ink">
                          <input type="checkbox" checked={checked.has(key)} onChange={() => toggleChecked(key)} />
                          {formatDateWithWeekday(d)}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <Button loading={backfilling} disabled={checked.size === 0} onClick={handleBackfill}>
                補簽 {checked.size} 天（出席）
              </Button>
            </>
          )}
        </div>
      </Modal>

      <AlertModal open={alertMsg !== null} onClose={() => setAlertMsg(null)} title="格式錯誤">
        {alertMsg}
      </AlertModal>
    </div>
  );
}
