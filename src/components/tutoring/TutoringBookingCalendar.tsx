'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

// 同一天、同一星期可能有 2 個以上作用中窗口（例如一場下午、一場晚上，
// 不同老師）——這種情況要顯示選擇器讓學生自己挑，不能合併容量、也不能
// 自動選一個（2026-08-28 產品決策）。
export interface AvailabilityWindowOption {
  windowId: string;
  startTime: string;
  endTime: string;
  teacherNames: string[];
  capacity: number;
  remaining: number;
}

export interface AvailabilityDay {
  date: string;
  // 相容單一窗口的情境：永遠等於 windows[0]（時間最早的那個）。
  windowId: string;
  capacity: number;
  remaining: number;
  myBookingId: string | null;
  myBookingStatus: 'BOOKED' | 'PENDING_ADMIN' | null;
  myBookingCount: number;
  // 只有這天有 2 個以上作用中窗口時才會出現；只有 1 個窗口時是 undefined，
  // 行為與過去完全相同（不顯示選擇器，直接用上面的 windowId 預約）。
  windows?: AvailabilityWindowOption[];
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
  successMessage?: string;
  isAdmin?: boolean;
  onBooked: () => void;
  onCancelledBooking?: () => void;
  // 已勾選（尚未送出）的天數變動時通知外層，額度條要即時扣剩餘
  onSelectionChange?: (count: number) => void;
}

// 預約不再選時段，一天就是一格：可以連點好幾天再一次送出（每天各自建立
// 一筆預約、各自檢查容量）。格子上顯示當天剩餘名額。本人已約的日期以
// 「已約」標示，點擊可直接取消該天預約（按掉）。
export default function TutoringBookingCalendar({
  enrollmentId,
  successMessage,
  isAdmin,
  onBooked,
  onCancelledBooking,
  onSelectionChange,
}: TutoringBookingCalendarProps) {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  // 已勾選（尚未送出）的日期＋各自選定的窗口。單一窗口的日期點一下直接帶入
  // 該窗口的 windowId；有 2 個以上窗口時要先跳出 pickerDay 選擇器，選完才會
  // 加進這裡。
  const [selections, setSelections] = useState<{ date: string; windowId: string }[]>([]);
  const [pickerDay, setPickerDay] = useState<AvailabilityDay | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedDates = selections.map((s) => s.date);

  useEffect(() => {
    onSelectionChange?.(selections.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);

  async function loadAvailability() {
    const res = await fetch(`/api/tutoring-availability?enrollmentId=${enrollmentId}`);
    setAvailability(await res.json());
  }

  useEffect(() => {
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId]);

  const now = new Date();
  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth() + 1;
  const availabilityByDate = new Map(availability.map((day) => [day.date, day]));

  // 單一窗口的日期：點一下直接帶入該窗口（沿用過去行為）。已有 2 個以上
  // 窗口的日期：先跳出選擇器，選定哪個窗口後才真的加進 selections（見
  // pickWindow）；再點一次已選定的日期則直接取消勾選，不用重選一次。
  function toggleDay(day: AvailabilityDay) {
    if (selections.some((s) => s.date === day.date)) {
      setSelections((prev) => prev.filter((s) => s.date !== day.date));
      return;
    }
    if (day.windows && day.windows.length > 1) {
      setPickerDay(day);
      return;
    }
    setSelections((prev) => [...prev, { date: day.date, windowId: day.windowId }].sort((a, b) => a.date.localeCompare(b.date)));
  }

  function pickWindow(day: AvailabilityDay, windowId: string) {
    setSelections((prev) => [...prev, { date: day.date, windowId }].sort((a, b) => a.date.localeCompare(b.date)));
    setPickerDay(null);
  }

  // 按掉已約日期＝取消該天預約。學生自行取消一律不計次（含當天），行政端
  // 走原本免計次取消，兩邊文案一致，不用再依日期分流。
  async function cancelBookedDay(day: AvailabilityDay) {
    if (submitting || !day.myBookingId) return;
    const dateLabel = formatDateWithWeekday(day.date, 'zh-TW');
    const message = isAdmin ? `確定要取消 ${dateLabel} 的預約嗎？（不計次）` : `確定要取消 ${dateLabel} 的預約嗎？`;
    if (!(await confirm(message))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tutoring-bookings/${day.myBookingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countsTowardQuota: false }),
      });
      if (!res.ok) {
        showToast('取消失敗，請稍後再試');
        return;
      }
      showToast('已取消預約');
      onCancelledBooking?.();
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
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
            const mine = !!day?.myBookingId;
            // 已約／待審日期都可按掉取消（PENDING_ADMIN＝超額送審中，一律開放
            // 本人取消，不分新舊資料；取消不計次）
            const cancellable = mine;
            // 有 2 個以上窗口時，只要其中任一個還有名額就算這天可預約（不合併
            // 容量，實際選哪個窗口由選擇器決定）。
            const anyRemaining = day ? (day.windows ? day.windows.some((w) => w.remaining > 0) : day.remaining > 0) : false;
            const bookable = !mine && !!day && anyRemaining;
            const selected = !mine && selectedDates.includes(cell.dateKey);
            return (
              <button
                key={cell.dateKey}
                disabled={mine ? !cancellable : !bookable}
                onClick={() => day && (mine ? cancelBookedDay(day) : toggleDay(day))}
                className={`flex flex-col items-center rounded-lg py-1.5 text-sm ${
                  mine
                    ? 'bg-pendingBg font-semibold text-pending'
                    : selected
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
                  <span className={`text-[10px] font-normal ${mine ? 'text-pending' : selected ? 'text-brandInk' : 'text-inkMuted'}`}>
                    {mine
                      ? day.myBookingCount > 1
                        ? `已約×${day.myBookingCount}`
                        : day.myBookingStatus === 'PENDING_ADMIN'
                          ? '待審'
                          : '已約'
                      : day.windows
                        ? anyRemaining
                          ? `${day.windows.length}時段可選`
                          : '已滿'
                        : day.remaining > 0
                          ? `剩${day.remaining}`
                          : '已滿'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  async function submitSelected() {
    setSubmitting(true);
    try {
      const failed: string[] = [];
      let pendingCount = 0;
      for (const { date, windowId } of selections) {
        const res = await fetch('/api/tutoring-bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollmentId, windowId, date }),
        });
        if (!res.ok) {
          failed.push(date);
        } else {
          const created = await res.json();
          if (created.status === 'PENDING_ADMIN') pendingCount++;
        }
      }
      const okCount = selections.length - failed.length;
      if (failed.length > 0) {
        showToast(`${failed.map((d) => formatDateWithWeekday(d, 'zh-TW')).join('、')} 預約失敗（可能已滿或當天已有預約），其餘已預約`);
      } else if (pendingCount === 0) {
        showToast(successMessage ?? `已預約 ${okCount} 天`);
      } else if (pendingCount === okCount) {
        showToast(`已送審 ${pendingCount} 天（超過本月額度，行政核准後才成立）`);
      } else {
        showToast(`已預約 ${okCount - pendingCount} 天，另 ${pendingCount} 天超過本月額度已送行政審核`);
      }
      setSelections([]);
      onBooked();
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {renderMonthGrid(calendarYear, calendarMonth)}

      {availability.some((d) => d.myBookingId) && (
        <p className="text-xs text-inkMuted">「已約／待審」為這位學生已預約的日期，點一下即可取消該天預約。</p>
      )}

      {(
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
              <Button variant="secondary" onClick={() => setSelections([])}>
                清除
              </Button>
            </div>
          </div>
        )
      )}
      <Modal open={!!pickerDay} onClose={() => setPickerDay(null)} title={pickerDay ? `選擇時段・${formatDateWithWeekday(pickerDay.date, 'zh-TW')}` : undefined}>
        {pickerDay?.windows && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-inkMuted">這天有 {pickerDay.windows.length} 個時段，請選擇要預約哪一個：</p>
            {pickerDay.windows.map((option) => (
              <button
                key={option.windowId}
                type="button"
                disabled={option.remaining <= 0}
                onClick={() => pickWindow(pickerDay, option.windowId)}
                className="flex items-center justify-between gap-3 rounded-lg border border-borderSubtle px-3 py-2 text-left text-sm transition-colors hover:bg-stripe disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="min-w-0">
                  <span className="font-semibold text-ink">
                    {option.startTime}–{option.endTime}
                  </span>
                  {option.teacherNames.length > 0 && <span className="ml-2 text-inkMuted">{option.teacherNames.join('、')}</span>}
                </span>
                <span className={`shrink-0 font-semibold ${option.remaining > 0 ? 'text-approved' : 'text-inkMuted'}`}>
                  {option.remaining > 0 ? `剩${option.remaining}` : '已滿'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}
