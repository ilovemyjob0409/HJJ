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

interface Enrollment {
  id: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
}

interface BookingRow {
  id: string;
  programName: string;
  date: string;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
  canCancelFree: boolean;
  canRequestMakeup: boolean;
}

export default function StudentTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [makeupFor, setMakeupFor] = useState<BookingRow | null>(null);
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
    const message = row.canCancelFree
      ? '確定要取消這筆預約嗎？'
      : '今天取消會計入本月次數，之後可申請補課。確定要取消嗎？';
    if (!(await confirm(message, { danger: !row.canCancelFree }))) return;
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
    { header: '課程', render: (r) => r.programName },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date) },
    { header: '時間', render: (r) => `${r.startTime}-${r.endTime}` },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex flex-col items-center gap-1">
          {r.status === 'BOOKED' && (
            <Button className="px-3 py-1 text-xs" variant="secondary" onClick={() => cancelBooking(r)}>
              取消
            </Button>
          )}
          {r.canRequestMakeup && (
            <Button className="px-3 py-1 text-xs" onClick={() => setMakeupFor(r)}>
              申請補課
            </Button>
          )}
        </div>
      ),
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
              <p className="text-sm text-inkMuted">
                {selectedEnrollment.programName}・本月已計次 <b className="text-ink">{selectedEnrollment.locked}</b>／
                {selectedEnrollment.monthlyQuota} 堂
                {selectedEnrollment.upcoming > 0 && <>（另有 {selectedEnrollment.upcoming} 堂已預約未到）</>}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stripe">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, (selectedEnrollment.locked / selectedEnrollment.monthlyQuota) * 100)}%` }}
                />
              </div>
            </Card>
          )}

          <h2 className="mb-2 font-bold text-ink">{makeupFor ? '本月及下月可預約時段' : '本月可預約時段'}</h2>
          <Card className="mb-6">
            {selectedEnrollment && (
              <TutoringBookingCalendar
                key={`${selectedEnrollment.id}-${makeupFor ? 'makeup' : 'regular'}-${calendarRefreshKey}`}
                enrollmentId={selectedEnrollment.id}
                defaultDurationMinutes={selectedEnrollment.defaultDurationMinutes}
                mode={makeupFor ? 'makeup' : 'regular'}
                makeupForBookingId={makeupFor?.id}
                onCancel={() => setMakeupFor(null)}
                onBooked={() => {
                  loadBookings();
                  if (!makeupFor) loadEnrollments();
                  setMakeupFor(null);
                }}
              />
            )}
          </Card>

          {makeupFor && (
            <Card className="mb-6 border-pending">
              <p className="text-sm text-ink">
                正在為 <b>{formatDateWithWeekday(makeupFor.date)}（{makeupFor.startTime}-{makeupFor.endTime}）</b>
                的缺席選一個補課時間，請在上方點選日期。
              </p>
            </Card>
          )}

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
