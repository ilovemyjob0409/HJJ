'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';
import TutoringQuotaBar from '@/components/tutoring/TutoringQuotaBar';

interface MissedBookingOption {
  id: string;
  date: string;
}

interface QuotaStatus {
  locked: number;
  upcoming: number;
  quota: number;
  upcomingBookings: { id: string; date: string; kind: 'REGULAR' | 'MAKEUP'; status: 'BOOKED' | 'PENDING_ADMIN' }[];
}

interface AdminBookingModalProps {
  enrollment: { id: string; studentId: string; studentName: string; programName: string };
  onClose: () => void;
  onBooked: () => void;
}

export default function AdminBookingModal({ enrollment, onClose, onBooked }: AdminBookingModalProps) {
  const [kind, setKind] = useState<'regular' | 'makeup'>('regular');
  const [missedBookings, setMissedBookings] = useState<MissedBookingOption[]>([]);
  const [makeupOriginalId, setMakeupOriginalId] = useState('');
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  async function loadQuota() {
    const res = await fetch(`/api/tutoring-enrollments/${enrollment.id}`);
    if (res.ok) setQuotaStatus(await res.json());
  }

  useEffect(() => {
    loadQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollment.id]);

  useEffect(() => {
    if (kind !== 'makeup') {
      setMissedBookings([]);
      setMakeupOriginalId('');
      return;
    }
    setMakeupOriginalId('');
    fetch(`/api/tutoring-bookings/makeup-eligible?enrollmentId=${enrollment.id}`)
      .then((res) => res.json())
      .then(setMissedBookings);
  }, [kind, enrollment.id]);

  return (
    <Modal open onClose={onClose} title={`新增預約：${enrollment.studentName}・${enrollment.programName}`}>
      {quotaStatus && (
        <div className="mb-3 rounded-lg bg-stripe px-3 py-2">
          <TutoringQuotaBar
            locked={quotaStatus.locked}
            upcoming={quotaStatus.upcoming}
            quota={quotaStatus.quota}
            selectedCount={kind === 'regular' ? selectedCount : 0}
          />
          {quotaStatus.upcomingBookings.length > 0 && (
            <p className="mt-1.5 text-xs text-inkMuted">
              已約日期：
              {quotaStatus.upcomingBookings
                .map((b) => `${formatDateWithWeekday(b.date)}${b.kind === 'MAKEUP' ? '（補課）' : ''}${b.status === 'PENDING_ADMIN' ? '（待核准）' : ''}`)
                .join('、')}
            </p>
          )}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-inkMuted">
          類型
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'regular' | 'makeup')}
            className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
          >
            <option value="regular">一般</option>
            <option value="makeup">補課</option>
          </select>
        </label>
        {kind === 'makeup' && (
          <label className="text-xs text-inkMuted">
            要補的缺席紀錄
            <select
              value={makeupOriginalId}
              onChange={(e) => setMakeupOriginalId(e.target.value)}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              <option value="">請選擇</option>
              {missedBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatDateWithWeekday(b.date)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {kind === 'makeup' && missedBookings.length === 0 && (
        <p className="text-sm text-inkMuted">這位學生目前沒有可補課的紀錄</p>
      )}
      {(kind === 'regular' || makeupOriginalId) && (
        <TutoringBookingCalendar
          key={`${kind}-${makeupOriginalId}`}
          enrollmentId={enrollment.id}
          mode={kind}
          makeupForBookingId={kind === 'makeup' ? makeupOriginalId : undefined}
          successMessage={kind === 'makeup' ? '已建立補課預約' : '已新增預約'}
          isAdmin
          onBooked={() => {
            onBooked();
            onClose();
          }}
          onCancelledBooking={() => {
            loadQuota();
            onBooked();
          }}
          onSelectionChange={setSelectedCount}
        />
      )}
    </Modal>
  );
}
