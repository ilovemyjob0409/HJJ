'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT';

const STATUS_OPTIONS: { value: AttendanceStatusValue; label: string }[] = [
  { value: 'PRESENT', label: '出席' },
  { value: 'LATE', label: '遲到' },
  { value: 'LEFT_EARLY', label: '早退' },
  { value: 'ON_LEAVE', label: '請假' },
  { value: 'ABSENT', label: '缺席未請假' },
];

export interface RosterRow {
  key: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  defaultOnLeave?: boolean;
  quotaLabel?: string;
}

export interface SavedRecord {
  studentId: string;
  key: string;
  status: AttendanceStatusValue;
  checkInTime?: string;
  checkOutTime?: string;
}

interface Props {
  rows: RosterRow[];
  onSave: (records: SavedRecord[]) => Promise<void>;
}

export default function AttendanceRosterEditor({ rows, onSave }: Props) {
  const [edits, setEdits] = useState<Record<string, { status: AttendanceStatusValue; checkInTime: string; checkOutTime: string }>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.key,
        {
          status: r.status ?? (r.defaultOnLeave ? 'ON_LEAVE' : 'PRESENT'),
          checkInTime: r.checkInTime ?? '',
          checkOutTime: r.checkOutTime ?? '',
        },
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  function updateStatus(key: string, status: AttendanceStatusValue) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], status } }));
  }
  function updateTime(key: string, field: 'checkInTime' | 'checkOutTime', value: string) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(
        rows.map((r) => ({
          studentId: r.studentId,
          key: r.key,
          status: edits[r.key].status,
          checkInTime: edits[r.key].checkInTime || undefined,
          checkOutTime: edits[r.key].checkOutTime || undefined,
        }))
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-inkMuted">名單是空的</p>
      ) : (
        rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-2 rounded-lg border border-borderSubtle p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">{r.studentName}</span>
              {r.quotaLabel && <span className="text-xs text-inkMuted">{r.quotaLabel}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateStatus(r.key, opt.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    edits[r.key].status === opt.value
                      ? 'bg-brand text-brandInk'
                      : 'border border-borderStrong text-inkMuted hover:bg-stripe'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="簽到時間"
                value={edits[r.key].checkInTime}
                onChange={(e) => updateTime(r.key, 'checkInTime', e.target.value)}
                className="w-28"
              />
              <Input
                placeholder="簽退時間"
                value={edits[r.key].checkOutTime}
                onChange={(e) => updateTime(r.key, 'checkOutTime', e.target.value)}
                className="w-28"
              />
            </div>
          </div>
        ))
      )}
      {rows.length > 0 && (
        <Button onClick={handleSave} loading={saving}>
          儲存點名
        </Button>
      )}
    </div>
  );
}
