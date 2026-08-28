'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { attendanceDisplayStatus } from '@/lib/attendanceDisplay';
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';
import TutoringQuotaBar from '@/components/tutoring/TutoringQuotaBar';
import TutoringPolicyModal from '@/components/tutoring/TutoringPolicyModal';

interface Enrollment {
  id: string;
  programId: string;
  programName: string;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
  pendingOverQuota: number;
}

interface BookingRow {
  id: string;
  programName: string;
  date: string;
  // MAKEUP 等狀態僅出現在歷史紀錄（現行收費規範沒有補課概念）
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export default function StudentTutoringPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [attendanceRows, setAttendanceRows] = useState<BookingRow[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);

  async function loadEnrollments() {
    try {
      const res = await fetch('/api/tutoring-enrollments/me');
      const rows: Enrollment[] = await res.json();
      setEnrollments(rows);
      if (rows.length > 0) setSelectedEnrollmentId((prev) => prev || rows[0].id);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttendance() {
    const res = await fetch('/api/tutoring-bookings');
    setAttendanceRows(await res.json());
  }

  useEffect(() => {
    loadEnrollments();
    loadAttendance();
  }, []);

  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);

  // 欄位同行政端「出缺勤紀錄」，前面多一欄課程（學生可能報名多門）。
  // 取消預約走日曆的「已約」按掉，這張表沒有操作欄。
  const attendanceColumns: Column<BookingRow>[] = [
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    {
      header: '狀態',
      render: (r) => <StatusBadge status={attendanceDisplayStatus(r.attendanceStatus, r.status)} />,
      sortValue: (r) => attendanceDisplayStatus(r.attendanceStatus, r.status),
    },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般'), sortValue: (r) => (r.kind === 'MAKEUP' ? 1 : 0) },
    { header: '簽到', render: (r) => r.checkInTime ?? '-', sortValue: (r) => r.checkInTime ?? null },
    { header: '簽退', render: (r) => r.checkOutTime ?? '-', sortValue: (r) => r.checkOutTime ?? null },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">個別輔導預約</h1>
        <TutoringPolicyModal />
      </div>

      {loading ? (
        <Card>
          <p className="text-sm text-inkMuted">載入中…</p>
        </Card>
      ) : enrollments.length === 0 ? (
        <Card>
          <p className="text-sm text-inkMuted">目前沒有已報名的個別輔導課程</p>
        </Card>
      ) : (
        <>
          {enrollments.length > 1 && (
            <div className="mb-4 flex gap-2">
              {enrollments.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEnrollmentId(e.id)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    e.id === selectedEnrollmentId ? 'bg-brand text-brandInk' : 'border border-borderStrong text-inkMuted'
                  }`}
                >
                  {e.programName}
                </button>
              ))}
            </div>
          )}

          {selectedEnrollment && (
            <Card className="mb-4">
              <p className="mb-1 text-sm font-semibold text-ink">{selectedEnrollment.programName}</p>
              <TutoringQuotaBar
                locked={selectedEnrollment.locked}
                upcoming={selectedEnrollment.upcoming}
                quota={selectedEnrollment.monthlyQuota}
                pendingOverQuota={selectedEnrollment.pendingOverQuota}
                selectedCount={selectedCount}
              />
            </Card>
          )}

          <h2 className="mb-2 font-bold text-ink">本月可預約日期</h2>
          <Card className="mb-6">
            {selectedEnrollment && (
              <TutoringBookingCalendar
                key={selectedEnrollment.id}
                enrollmentId={selectedEnrollment.id}
                onSelectionChange={setSelectedCount}
                onBooked={() => {
                  loadAttendance();
                  loadEnrollments();
                }}
                onCancelledBooking={() => {
                  loadAttendance();
                  loadEnrollments();
                }}
              />
            )}
          </Card>

          <h2 className="mb-2 font-bold text-ink">我的出缺勤紀錄</h2>
          <Card>
            <CollapsibleDataTable columns={attendanceColumns} rows={attendanceRows} keyField={(r) => r.id} maxRows={3} emptyText="尚無出缺勤紀錄" />
          </Card>
        </>
      )}
    </>
  );
}
