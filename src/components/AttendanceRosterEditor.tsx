'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT';
type EditableStatus = AttendanceStatusValue | 'UNMARKED';

const STATUS_OPTIONS: { value: EditableStatus; label: string }[] = [
  { value: 'UNMARKED', label: '未點名' },
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
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

export interface ClearedRecord {
  studentId: string;
  key: string;
}

interface Props {
  rows: RosterRow[];
  onSave: (records: SavedRecord[], clears: ClearedRecord[]) => Promise<void>;
}

export default function AttendanceRosterEditor({ rows, onSave }: Props) {
  const [edits, setEdits] = useState<Record<string, { status: EditableStatus; checkInTime: string; checkOutTime: string }>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.key,
        {
          status: r.status ?? (r.defaultOnLeave ? 'ON_LEAVE' : 'UNMARKED'),
          checkInTime: r.checkInTime ?? '',
          checkOutTime: r.checkOutTime ?? '',
        },
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  function updateStatus(key: string, status: EditableStatus) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], status } }));
  }
  function updateTime(key: string, field: 'checkInTime' | 'checkOutTime', value: string) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSave() {
    // Students left at UNMARKED who never had a saved record are skipped
    // entirely — so opening a roster and saving without touching anything
    // writes nothing, instead of defaulting everyone to PRESENT. Students
    // switched back to UNMARKED who DID have a saved record (e.g. undoing a
    // kiosk check-in) need their existing record deleted, not just skipped.
    const records = rows
      .filter((r) => edits[r.key].status !== 'UNMARKED')
      .map((r) => ({
        studentId: r.studentId,
        key: r.key,
        status: edits[r.key].status as AttendanceStatusValue,
        checkInTime: edits[r.key].checkInTime || null,
        checkOutTime: edits[r.key].checkOutTime || null,
      }));
    const clears = rows
      .filter((r) => edits[r.key].status === 'UNMARKED' && r.status !== null)
      .map((r) => ({ studentId: r.studentId, key: r.key }));
    if (records.length === 0 && clears.length === 0) return;
    setSaving(true);
    try {
      await onSave(records, clears);
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
              {STATUS_OPTIONS.map((opt) => {
                const selected = edits[r.key].status === opt.value;
                const className = selected
                  ? opt.value === 'UNMARKED'
                    ? 'bg-stripe text-inkMuted'
                    : 'bg-brand text-brandInk'
                  : 'border border-borderStrong text-inkMuted hover:bg-stripe';
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateStatus(r.key, opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${className}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
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
