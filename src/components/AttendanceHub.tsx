'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import AttendanceRosterEditor, { RosterRow, SavedRecord, ClearedRecord } from '@/components/AttendanceRosterEditor';

type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';

interface SessionSummary {
  type: SessionType;
  id: string;
  title: string;
  timeLabel: string;
  markedCount: number;
  totalCount: number;
}

const TYPE_LABEL: Record<SessionType, string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
};

interface ClassRosterApiRow {
  studentId: string;
  studentName: string;
  makeupRequestId: string | null;
  onLeave: boolean;
  status: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

interface SimpleRosterApiRow {
  studentId: string;
  studentName: string;
  status: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export function todayDateInput() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function apiPathFor(type: SessionType, id: string) {
  if (type === 'CLASS') return `/api/attendance/class/${id}`;
  if (type === 'ONE_ON_ONE') return `/api/attendance/one-on-one/${id}`;
  if (type === 'GO_HALL') return `/api/attendance/go-hall/${id}`;
  return `/api/attendance/activity/${id}`;
}

export default function AttendanceHub({ hideDatePicker = false }: { hideDatePicker?: boolean }) {
  const [date, setDate] = useState(todayDateInput());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<SessionSummary | null>(null);
  const [rosterRows, setRosterRows] = useState<RosterRow[] | null>(null);
  const { showToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/sessions?date=${date}`);
      setSessions(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function openSession(s: SessionSummary) {
    setOpening(s);
    if (s.type === 'CLASS') {
      const res = await fetch(`/api/attendance/class/${s.id}?date=${date}`);
      const { roster, quotaByStudentId } = await res.json();
      setRosterRows(
        roster.map((r: ClassRosterApiRow) => ({
          key: r.makeupRequestId ?? r.studentId,
          studentId: r.studentId,
          studentName: r.studentName + (r.makeupRequestId ? '（插班）' : ''),
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          defaultOnLeave: r.onLeave,
          quotaLabel:
            !r.makeupRequestId && quotaByStudentId[r.studentId]?.totalSessions != null
              ? `已上 ${quotaByStudentId[r.studentId].usedSessions}／共 ${quotaByStudentId[r.studentId].totalSessions} 堂`
              : undefined,
        }))
      );
    } else if (s.type === 'ONE_ON_ONE') {
      const res = await fetch(`/api/attendance/one-on-one/${s.id}`);
      const r = await res.json();
      setRosterRows([
        {
          key: r.makeupRequestId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        },
      ]);
    } else if (s.type === 'GO_HALL') {
      const res = await fetch(`/api/attendance/go-hall/${s.id}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: SimpleRosterApiRow) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        }))
      );
    } else {
      const res = await fetch(`/api/attendance/activity/${s.id}?date=${date}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: SimpleRosterApiRow) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        }))
      );
    }
  }

  async function handleSaveRoster(records: SavedRecord[], clears: ClearedRecord[]) {
    if (!opening) return;
    const path = apiPathFor(opening.type, opening.id);

    if (records.length > 0) {
      const body =
        opening.type === 'ONE_ON_ONE'
          ? records[0]
          : {
              date,
              records: records.map((r) => ({
                studentId: r.studentId,
                status: r.status,
                checkInTime: r.checkInTime,
                checkOutTime: r.checkOutTime,
                ...(opening.type === 'CLASS' && r.key !== r.studentId ? { makeupRequestId: r.key } : {}),
              })),
            };
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
    }

    if (clears.length > 0) {
      const body =
        opening.type === 'ONE_ON_ONE'
          ? {}
          : opening.type === 'CLASS'
            ? {
                date,
                clear: clears.map((c) =>
                  c.key !== c.studentId ? { studentId: c.studentId, makeupRequestId: c.key } : { studentId: c.studentId }
                ),
              }
            : opening.type === 'GO_HALL'
              ? { clear: clears.map((c) => c.studentId) }
              : { date, clear: clears.map((c) => c.studentId) };
      const res = await fetch(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
    }

    showToast('點名已儲存');
    setOpening(null);
    setRosterRows(null);
    load();
  }

  const columns: Column<SessionSummary>[] = [
    { header: '類型', render: (s) => TYPE_LABEL[s.type] },
    { header: '名稱', render: (s) => s.title },
    { header: '時間', render: (s) => s.timeLabel || '-' },
    { header: '點名進度', render: (s) => `${s.markedCount}/${s.totalCount}` },
  ];

  return (
    <>
      {!hideDatePicker && (
        <div className="mb-4">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      <Card>
        <DataTable
          columns={columns}
          rows={sessions}
          loading={loading}
          keyField={(s) => `${s.type}-${s.id}`}
          onRowClick={openSession}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal
        open={opening !== null}
        onClose={() => {
          setOpening(null);
          setRosterRows(null);
        }}
        title={opening ? `${TYPE_LABEL[opening.type]}點名 - ${opening.title}` : ''}
        maxWidthClassName="max-w-2xl"
      >
        {rosterRows && <AttendanceRosterEditor rows={rosterRows} onSave={handleSaveRoster} />}
      </Modal>
    </>
  );
}
