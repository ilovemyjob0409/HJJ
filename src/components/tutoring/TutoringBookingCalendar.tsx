'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

export interface AvailabilityDay {
  date: string;
  windowId: string;
  windowStartTime: string;
  windowEndTime: string;
  capacity: number;
  slots: { startTime: string; remaining: number }[];
}

interface MonthCell {
  day: number;
  dateKey: string;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function buildMonthCells(year: number, month: number): MonthCell[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateKey: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  return cells;
}

interface TutoringBookingCalendarProps {
  enrollmentId: string;
  defaultDurationMinutes: number;
  mode: 'regular' | 'makeup';
  makeupForBookingId?: string;
  successMessage?: string;
  onCancel?: () => void;
  onBooked: () => void;
}

export default function TutoringBookingCalendar({
  enrollmentId,
  defaultDurationMinutes,
  mode,
  makeupForBookingId,
  successMessage,
  onCancel,
  onBooked,
}: TutoringBookingCalendarProps) {
  const { showToast } = useToast();
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function loadAvailability() {
    const months = mode === 'makeup' ? 2 : 1;
    const res = await fetch(`/api/tutoring-availability?enrollmentId=${enrollmentId}&months=${months}`);
    setAvailability(await res.json());
  }

  useEffect(() => {
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId, mode]);

  const now = new Date();
  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth() + 1;
  const availabilityByDate = new Map(availability.map((day) => [day.date, day]));
  const openDayData = openDay ? availabilityByDate.get(openDay) : undefined;

  const nextMonthDate = new Date(Date.UTC(calendarYear, calendarMonth, 1));
  const nextCalendarYear = nextMonthDate.getUTCFullYear();
  const nextCalendarMonth = nextMonthDate.getUTCMonth() + 1;

  function renderMonthGrid(year: number, month: number) {
    const cells = buildMonthCells(year, month);
    const leadingBlanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return (
      <div className="mb-4" key={`${year}-${month}`}>
        <p className="mb-3 text-center font-semibold text-ink">
          {year}年{month}月
        </p>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-inkMuted">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <span key={`blank-${year}-${month}-${i}`} />
          ))}
          {cells.map((cell) => {
            const day = availabilityByDate.get(cell.dateKey);
            return (
              <button
                key={cell.dateKey}
                disabled={!day}
                onClick={() => day && openDayForBooking(day)}
                className={`rounded-lg py-2 text-sm ${
                  openDay === cell.dateKey
                    ? 'bg-brand font-semibold text-brandInk'
                    : day
                      ? 'bg-approvedBg font-semibold text-approved'
                      : 'text-inkMuted opacity-50'
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function openDayForBooking(day: AvailabilityDay) {
    setOpenDay(day.date);
    const firstAvailable = day.slots.find((s) => s.remaining > 0);
    const start = firstAvailable?.startTime ?? day.windowStartTime;
    setStartTime(start);
    setEndTime(addMinutes(start, defaultDurationMinutes));
  }

  async function submit(day: AvailabilityDay) {
    setSubmitting(true);
    try {
      const url = mode === 'makeup' ? `/api/tutoring-bookings/${makeupForBookingId}/makeup` : '/api/tutoring-bookings';
      const body =
        mode === 'makeup'
          ? { windowId: day.windowId, date: day.date, startTime, endTime }
          : { enrollmentId, windowId: day.windowId, date: day.date, startTime, endTime };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(
          error === 'WINDOW_FULL'
            ? '這段時間名額已滿，請選別的時間'
            : mode === 'makeup'
              ? '申請失敗，請確認時間範圍'
              : '預約失敗，請確認時間範圍'
        );
        return;
      }
      showToast(successMessage ?? (mode === 'makeup' ? '已送出補課申請，待行政核准' : '預約成功'));
      setOpenDay(null);
      onBooked();
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {renderMonthGrid(calendarYear, calendarMonth)}
      {mode === 'makeup' && renderMonthGrid(nextCalendarYear, nextCalendarMonth)}

      {openDayData && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borderSubtle pt-3">
          <label className="text-xs text-inkMuted">
            開始
            <select
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setEndTime(addMinutes(e.target.value, defaultDurationMinutes));
              }}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              {openDayData.slots.map((s) => (
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
              {openDayData.slots
                .map((s) => s.startTime)
                .concat(openDayData.windowEndTime)
                .filter((t) => t > startTime)
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>
          </label>
          <Button loading={submitting} onClick={() => submit(openDayData)}>
            {mode === 'makeup' ? '確定補課時間' : '確定預約'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpenDay(null);
              onCancel?.();
            }}
          >
            取消
          </Button>
        </div>
      )}
    </>
  );
}
