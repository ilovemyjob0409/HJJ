'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import AttendanceRosterEditor, { AttendanceStatusValue, RosterRow, SavedRecord, ClearedRecord } from '@/components/AttendanceRosterEditor';
import { TUTORING_HIDDEN_STATUSES } from '@/components/attendanceStatusOptions';
import { hasDate, rowsFromResponse, classRosterFromResponse } from '@/components/attendanceHubFetch';

type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY' | 'TUTORING';

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
  TUTORING: '個別輔導',
};

interface ClassRosterApiRow {
  studentId: string;
  studentName: string;
  makeupRequestId: string | null;
  onLeave: boolean;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

interface SimpleRosterApiRow {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

interface GoHallRosterApiRow extends SimpleRosterApiRow {
  qualification: 'SEASON_PASS' | 'TICKET' | 'SINGLE' | null;
  qualificationPredicted: boolean;
}

const GO_HALL_QUALIFICATION_LABEL: Record<string, string> = {
  SEASON_PASS: '季票',
  TICKET: '堂票',
  SINGLE: '單堂（現場收費）',
};

interface TutoringRosterApiRow {
  bookingId: string;
  studentId: string;
  studentName: string;
  isMakeup: boolean;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  quotaLabel: string;
}

// 個別輔導點名的「現場加入」資訊（未預約到場的學生由老師/行政當場登記）
interface WalkInInfo {
  candidates: { enrollmentId: string; studentId: string; studentName: string }[];
  booked: number;
  capacity: number;
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
  if (type === 'TUTORING') return `/api/attendance/tutoring/${id}`;
  return `/api/attendance/activity/${id}`;
}

export default function AttendanceHub({ hideDatePicker = false }: { hideDatePicker?: boolean }) {
  const [date, setDate] = useState(todayDateInput());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<SessionSummary | null>(null);
  const [rosterRows, setRosterRows] = useState<RosterRow[] | null>(null);
  const [walkIn, setWalkIn] = useState<WalkInInfo | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInQuery, setWalkInQuery] = useState('');
  const [walkInBusy, setWalkInBusy] = useState(false);
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    if (!hasDate(date)) return; // 日期欄可被鍵盤清空；空日期不查詢，保留原列表
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/sessions?date=${date}`);
      const rows = rowsFromResponse<SessionSummary>(res.ok, await res.json());
      if (rows) setSessions(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function failRoster() {
    showToast('載入點名資料失敗，請稍後再試');
    closeRoster();
  }

  async function openSession(s: SessionSummary) {
    if (!hasDate(date)) {
      showToast('請先選擇日期');
      return;
    }
    setOpening(s);
    if (s.type === 'CLASS') {
      const res = await fetch(`/api/attendance/class/${s.id}?date=${date}`);
      const data = classRosterFromResponse<
        ClassRosterApiRow,
        Record<string, { totalSessions: number | null; usedSessions: number }>
      >(res.ok, await res.json());
      if (!data) return failRoster();
      const { roster, quotaByStudentId } = data;
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
      if (!res.ok) return failRoster();
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
      const roster = rowsFromResponse<GoHallRosterApiRow>(res.ok, await res.json());
      if (!roster) return failRoster();
      setRosterRows(
        roster.map((r: GoHallRosterApiRow) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          quotaLabel: r.qualification
            ? (r.qualificationPredicted ? '預計：' : '') + GO_HALL_QUALIFICATION_LABEL[r.qualification]
            : undefined,
          quotaTone: r.qualification === 'SINGLE' ? ('warning' as const) : undefined,
        }))
      );
    } else if (s.type === 'TUTORING') {
      const [res, walkInRes] = await Promise.all([
        fetch(`/api/attendance/tutoring/${s.id}?date=${date}`),
        fetch(`/api/attendance/tutoring/${s.id}/walk-in?date=${date}`),
      ]);
      const roster = rowsFromResponse<TutoringRosterApiRow>(res.ok, await res.json());
      if (!roster) return failRoster();
      setRosterRows(
        roster.map((r: TutoringRosterApiRow) => ({
          key: r.bookingId,
          studentId: r.studentId,
          studentName: r.studentName + (r.isMakeup ? '（補課）' : ''),
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          quotaLabel: r.quotaLabel,
        }))
      );
      setWalkIn(walkInRes.ok ? await walkInRes.json() : null);
    } else {
      const res = await fetch(`/api/attendance/activity/${s.id}?date=${date}`);
      const roster = rowsFromResponse<SimpleRosterApiRow>(res.ok, await res.json());
      if (!roster) return failRoster();
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
          : opening.type === 'TUTORING'
            ? { records: records.map((r) => ({ bookingId: r.key, status: r.status, checkInTime: r.checkInTime, checkOutTime: r.checkOutTime })) }
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
            : opening.type === 'GO_HALL' || opening.type === 'TUTORING'
              ? { clear: clears.map((c) => c.key) }
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

  function closeRoster() {
    setOpening(null);
    setRosterRows(null);
    setWalkIn(null);
    setWalkInOpen(false);
    setWalkInQuery('');
  }

  // 未預約到場：現場登記一筆當天預約，之後點名/扣堂照一般流程走。
  // 名額已滿時經確認可強制加入（老師/行政都可）。
  async function addWalkIn(candidate: { enrollmentId: string; studentName: string }) {
    if (!opening || !walkIn || walkInBusy) return;
    const full = walkIn.booked >= walkIn.capacity;
    if (full) {
      const ok = await confirm(
        `今日名額已滿（${walkIn.booked}/${walkIn.capacity}），仍要強制加入「${candidate.studentName}」嗎？`,
        { danger: true }
      );
      if (!ok) return;
    }
    setWalkInBusy(true);
    try {
      const res = await fetch(`/api/attendance/tutoring/${opening.id}/walk-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: candidate.enrollmentId, date, force: full }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error === 'ALREADY_BOOKED_SAME_DAY' ? '這位學生今天已在名單上' : '加入失敗，請稍後再試');
        return;
      }
      showToast(`已加入 ${candidate.studentName}`);
      setWalkInQuery('');
      setWalkInOpen(false);
      await openSession(opening);
      load();
    } finally {
      setWalkInBusy(false);
    }
  }

  const columns: Column<SessionSummary>[] = [
    { header: '類型', render: (s) => TYPE_LABEL[s.type], sortValue: (s) => s.type },
    { header: '名稱', render: (s) => s.title, sortValue: (s) => s.title },
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
        onClose={closeRoster}
        title={opening ? `${TYPE_LABEL[opening.type]}點名 - ${opening.title}` : ''}
        maxWidthClassName="max-w-2xl"
      >
        {opening?.type === 'TUTORING' && walkIn && (
          <div className="mb-3">
            {!walkInOpen ? (
              <Button variant="link" className="text-sm" onClick={() => setWalkInOpen(true)}>
                ＋ 現場加入學生（今日 {walkIn.booked}/{walkIn.capacity}）
              </Button>
            ) : (
              <div className="rounded-lg border border-borderSubtle p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">現場加入（今日 {walkIn.booked}/{walkIn.capacity}）</p>
                  <Button variant="link" tone="muted" className="text-xs" onClick={() => setWalkInOpen(false)}>
                    收合
                  </Button>
                </div>
                <Input placeholder="搜尋學生姓名…" value={walkInQuery} onChange={(e) => setWalkInQuery(e.target.value)} />
                {(() => {
                  const q = walkInQuery.trim().toLowerCase();
                  const matches = walkIn.candidates
                    .filter((c) => !q || c.studentName.toLowerCase().includes(q))
                    .slice(0, 8);
                  if (matches.length === 0) {
                    return <p className="mt-2 text-sm text-inkMuted">沒有可加入的學生（未預約的有效報名才會出現）</p>;
                  }
                  return (
                    <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
                      {matches.map((c) => (
                        <button
                          key={c.enrollmentId}
                          type="button"
                          disabled={walkInBusy}
                          onClick={() => addWalkIn(c)}
                          className="flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe disabled:opacity-50"
                        >
                          <span className="text-ink">{c.studentName}</span>
                          <span className="text-xs text-brandDark">加入</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        {rosterRows && (
          <AttendanceRosterEditor
            key={rosterRows.map((r) => r.key).join(',')}
            rows={rosterRows}
            onSave={handleSaveRoster}
            hiddenStatuses={opening?.type === 'TUTORING' ? TUTORING_HIDDEN_STATUSES : undefined}
          />
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}
