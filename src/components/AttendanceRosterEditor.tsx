'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { normalizeTimeInput } from '@/lib/timeFormat';

import {
  AttendanceStatusValue,
  EditableStatus,
  visibleStatusOptions,
} from '@/components/attendanceStatusOptions';

export type { AttendanceStatusValue };

export interface RosterRow {
  key: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  defaultOnLeave?: boolean;
  quotaLabel?: string;
  quotaTone?: 'warning';
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
  hiddenStatuses?: AttendanceStatusValue[];
}

export default function AttendanceRosterEditor({ rows, onSave, hiddenStatuses }: Props) {
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
        checkInTime: normalizeTimeInput(edits[r.key].checkInTime) || null,
        checkOutTime: normalizeTimeInput(edits[r.key].checkOutTime) || null,
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
              {r.quotaLabel && (
                <span className={r.quotaTone === 'warning' ? 'text-xs font-semibold text-pending' : 'text-xs text-inkMuted'}>
                  {r.quotaLabel}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleStatusOptions(hiddenStatuses, edits[r.key].status).map((opt) => {
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
              <label className="flex flex-col gap-1 text-xs text-inkMuted">
                簽到
                <Input
                  type="time"
                  value={edits[r.key].checkInTime}
                  onChange={(e) => updateTime(r.key, 'checkInTime', e.target.value)}
                  className="w-28"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-inkMuted">
                簽退
                <Input
                  type="time"
                  value={edits[r.key].checkOutTime}
                  onChange={(e) => updateTime(r.key, 'checkOutTime', e.target.value)}
                  className="w-28"
                />
              </label>
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
