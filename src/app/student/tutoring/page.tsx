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

interface Enrollment {
  id: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
}

interface AvailabilityDay {
  date: string;
  windowId: string;
  windowStartTime: string;
  windowEndTime: string;
  capacity: number;
  slots: { startTime: string; remaining: number }[];
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

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function StudentTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [makeupFor, setMakeupFor] = useState<BookingRow | null>(null);

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

  async function loadAvailability(enrollmentId: string) {
    const res = await fetch(`/api/tutoring-availability?enrollmentId=${enrollmentId}`);
    setAvailability(await res.json());
  }

  useEffect(() => {
    loadEnrollments();
    loadBookings();
  }, []);

  useEffect(() => {
    if (selectedEnrollmentId) loadAvailability(selectedEnrollmentId);
  }, [selectedEnrollmentId]);

  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);

  function openDayForBooking(day: AvailabilityDay) {
    setOpenDay(day.date);
    const firstAvailable = day.slots.find((s) => s.remaining > 0);
    const start = firstAvailable?.startTime ?? day.windowStartTime;
    setStartTime(start);
    setEndTime(addMinutes(start, selectedEnrollment?.defaultDurationMinutes ?? 120));
  }

  async function submitBooking(day: AvailabilityDay) {
    if (!selectedEnrollment) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tutoring-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: selectedEnrollment.id, windowId: day.windowId, date: day.date, startTime, endTime }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(error === 'WINDOW_FULL' ? '這段時間名額已滿，請選別的時間' : '預約失敗，請確認時間範圍');
        return;
      }
      showToast('預約成功');
      setOpenDay(null);
      loadBookings();
      loadAvailability(selectedEnrollment.id);
      loadEnrollments();
    } finally {
      setSubmitting(false);
    }
  }

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
    loadBookings();
    if (selectedEnrollmentId) loadAvailability(selectedEnrollmentId);
    loadEnrollments();
  }

  async function submitMakeup(day: AvailabilityDay) {
    if (!makeupFor) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tutoring-bookings/${makeupFor.id}/makeup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId: day.windowId, date: day.date, startTime, endTime }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(error === 'WINDOW_FULL' ? '這段時間名額已滿，請選別的時間' : '申請失敗，請確認時間範圍');
        return;
      }
      showToast('已送出補課申請，待行政核准');
      setMakeupFor(null);
      setOpenDay(null);
      loadBookings();
      if (selectedEnrollmentId) loadAvailability(selectedEnrollmentId);
    } finally {
      setSubmitting(false);
    }
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

          <h2 className="mb-2 font-bold text-ink">未來兩週可預約時段</h2>
          <div className="mb-6 flex flex-col gap-2">
            {availability.length === 0 && (
              <Card>
                <p className="text-sm text-inkMuted">目前沒有開放的時段</p>
              </Card>
            )}
            {availability.map((day) => (
              <Card key={day.date}>
                <button className="flex w-full items-center justify-between" onClick={() => openDayForBooking(day)}>
                  <span className="font-semibold text-ink">{formatDateWithWeekday(day.date)}</span>
                  <span className="text-xs text-inkMuted">
                    {day.windowStartTime}-{day.windowEndTime}
                  </span>
                </button>
                <div className="mt-2 flex flex-wrap gap-1">
                  {day.slots.map((s) => (
                    <span
                      key={s.startTime}
                      title={`${s.startTime}：剩 ${s.remaining} 位`}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        s.remaining === 0 ? 'bg-rejectedBg text-rejected' : 'bg-approvedBg text-approved'
                      }`}
                    >
                      {s.startTime}・{s.remaining}
                    </span>
                  ))}
                </div>

                {openDay === day.date && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borderSubtle pt-3">
                    <label className="text-xs text-inkMuted">
                      開始
                      <select
                        value={startTime}
                        onChange={(e) => {
                          setStartTime(e.target.value);
                          setEndTime(addMinutes(e.target.value, selectedEnrollment?.defaultDurationMinutes ?? 120));
                        }}
                        className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                      >
                        {day.slots.map((s) => (
                          <option key={s.startTime} value={s.startTime} disabled={s.remaining === 0}>
                            {s.startTime}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-inkMuted">
                      結束
                      <select
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                      >
                        {day.slots
                          .map((s) => s.startTime)
                          .concat(day.windowEndTime)
                          .filter((t) => t > startTime)
                          .map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button loading={submitting} onClick={() => (makeupFor ? submitMakeup(day) : submitBooking(day))}>
                      {makeupFor ? '確定補課時間' : '確定預約'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOpenDay(null);
                        setMakeupFor(null);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>

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
