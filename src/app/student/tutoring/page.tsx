'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';
import TutoringQuotaBar from '@/components/tutoring/TutoringQuotaBar';

interface Enrollment {
  id: string;
  programId: string;
  programName: string;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
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
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  async function loadEnrollments() {
    const res = await fetch('/api/tutoring-enrollments/me');
    const rows: Enrollment[] = await res.json();
    setEnrollments(rows);
    if (rows.length > 0) setSelectedEnrollmentId((prev) => prev || rows[0].id);
  }

  async function loadBookings() {
    const res = await fetch('/api/tutoring-bookings');
    setBookings(await res.json());
  }

  useEffect(() => {
    loadEnrollments();
    loadBookings();
  }, []);

  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);

  async function cancelBooking(row: BookingRow) {
    if (!(await confirm('確定要取消這筆預約嗎？'))) return;
    const res = await fetch(`/api/tutoring-bookings/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('取消失敗，請稍後再試');
      return;
    }
    showToast('已取消');
    setCalendarRefreshKey((k) => k + 1);
    loadBookings();
    loadEnrollments();
  }

  const bookingColumns: Column<BookingRow>[] = [
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般'), sortValue: (r) => r.kind },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    {
      header: '出席',
      render: (r) => (r.attendanceStatus ? <StatusBadge status={r.attendanceStatus} /> : '-'),
      sortValue: (r) => r.attendanceStatus ?? null,
    },
    { header: '簽到', render: (r) => r.checkInTime ?? '-', sortValue: (r) => r.checkInTime ?? null },
    { header: '簽退', render: (r) => r.checkOutTime ?? '-', sortValue: (r) => r.checkOutTime ?? null },
    {
      header: '操作',
      render: (r) =>
        r.status === 'BOOKED' ? (
          <Button className="px-3 py-1 text-xs" variant="secondary" onClick={() => cancelBooking(r)}>
            取消
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約</h1>

      {enrollments.length === 0 ? (
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
              />
            </Card>
          )}

          <h2 className="mb-2 font-bold text-ink">本月可預約日期</h2>
          <Card className="mb-6">
            {selectedEnrollment && (
              <TutoringBookingCalendar
                key={`${selectedEnrollment.id}-${calendarRefreshKey}`}
                enrollmentId={selectedEnrollment.id}
                onBooked={() => {
                  loadBookings();
                  loadEnrollments();
                }}
                onCancelledBooking={() => {
                  loadBookings();
                  loadEnrollments();
                }}
              />
            )}
          </Card>

          <h2 className="mb-2 font-bold text-ink">我的預約紀錄</h2>
          <Card>
            <CollapsibleDataTable columns={bookingColumns} rows={bookings} keyField={(r) => r.id} maxRows={3} emptyText="目前沒有預約紀錄" />
          </Card>
        </>
      )}
      {ConfirmDialog}
    </>
  );
}
