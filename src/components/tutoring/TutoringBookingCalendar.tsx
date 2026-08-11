'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

export interface AvailabilityDay {
  date: string;
  windowId: string;
  capacity: number;
  remaining: number;
}

interface MonthCell {
  day: number;
  dateKey: string;
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
  mode: 'regular' | 'makeup';
  makeupForBookingId?: string;
  successMessage?: string;
  onCancel?: () => void;
  onBooked: () => void;
}

// 預約不再選時段，一天就是一格：一般預約可以連點好幾天再一次送出（每天各
// 自建立一筆預約、各自檢查容量）；補課是在補一筆特定的缺席，維持點一天就
// 直接送出。格子上顯示當天剩餘名額。
export default function TutoringBookingCalendar({
  enrollmentId,
  mode,
  makeupForBookingId,
  successMessage,
  onCancel,
  onBooked,
}: TutoringBookingCalendarProps) {
  const { showToast } = useToast();
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
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

  const nextMonthDate = new Date(Date.UTC(calendarYear, calendarMonth, 1));
  const nextCalendarYear = nextMonthDate.getUTCFullYear();
  const nextCalendarMonth = nextMonthDate.getUTCMonth() + 1;

  function toggleDay(day: AvailabilityDay) {
    if (mode === 'makeup') {
      submitMakeup(day);
      return;
    }
    setSelectedDates((prev) => (prev.includes(day.date) ? prev.filter((d) => d !== day.date) : [...prev, day.date].sort()));
  }

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
            const bookable = !!day && day.remaining > 0;
            const selected = selectedDates.includes(cell.dateKey);
            return (
              <button
                key={cell.dateKey}
                disabled={!bookable}
                onClick={() => day && toggleDay(day)}
                className={`flex flex-col items-center rounded-lg py-1.5 text-sm ${
                  selected
                    ? 'bg-brand font-semibold text-brandInk'
                    : bookable
                      ? 'bg-approvedBg font-semibold text-approved'
                      : day
                        ? 'bg-stripe text-inkMuted'
                        : 'text-inkMuted opacity-50'
                }`}
              >
                <span>{cell.day}</span>
                {day && (
                  <span className={`text-[10px] font-normal ${selected ? 'text-brandInk' : 'text-inkMuted'}`}>
                    {day.remaining > 0 ? `剩${day.remaining}` : '已滿'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  async function submitMakeup(day: AvailabilityDay) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tutoring-bookings/${makeupForBookingId}/makeup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId: day.windowId, date: day.date }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(error === 'WINDOW_FULL' ? '這天名額已滿，請選別天' : '申請失敗，請稍後再試');
        return;
      }
      showToast(successMessage ?? '已送出補課申請，待行政核准');
      onBooked();
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSelected() {
    setSubmitting(true);
    try {
      const failed: string[] = [];
      for (const date of selectedDates) {
        const day = availabilityByDate.get(date);
        if (!day) continue;
        const res = await fetch('/api/tutoring-bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollmentId, windowId: day.windowId, date }),
        });
        if (!res.ok) failed.push(date);
      }
      if (failed.length === 0) {
        showToast(successMessage ?? `已預約 ${selectedDates.length} 天`);
      } else {
        showToast(`${failed.map((d) => formatDateWithWeekday(d, 'zh-TW')).join('、')} 預約失敗（可能已滿），其餘已預約`);
      }
      setSelectedDates([]);
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

      {mode === 'makeup' ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-borderSubtle pt-3">
          <p className="text-sm text-inkMuted">{submitting ? '送出中…' : '點選日期即送出補課申請'}</p>
          <Button
            variant="secondary"
            onClick={() => {
              onCancel?.();
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        selectedDates.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-borderSubtle pt-3">
            <p className="text-sm text-ink">
              已選 <b>{selectedDates.length}</b> 天：
              <span className="text-inkMuted"> {selectedDates.map((d) => formatDateWithWeekday(d, 'zh-TW')).join('、')}</span>
            </p>
            <div className="flex gap-2">
              <Button loading={submitting} onClick={submitSelected}>
                確定預約
              </Button>
              <Button variant="secondary" onClick={() => setSelectedDates([])}>
                清除
              </Button>
            </div>
          </div>
        )
      )}
    </>
  );
}
