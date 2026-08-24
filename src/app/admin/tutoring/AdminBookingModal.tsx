'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';
import TutoringQuotaBar from '@/components/tutoring/TutoringQuotaBar';

interface QuotaStatus {
  locked: number;
  upcoming: number;
  quota: number;
  pendingOverQuota: number;
  // MAKEUP 僅出現在歷史資料；PENDING_ADMIN＝超額送審中的預約
  upcomingBookings: { id: string; date: string; kind: 'REGULAR' | 'MAKEUP'; status: 'BOOKED' | 'PENDING_ADMIN' }[];
}

interface AdminBookingModalProps {
  enrollment: { id: string; studentId: string; studentName: string; programName: string };
  onClose: () => void;
  onBooked: () => void;
}

export default function AdminBookingModal({ enrollment, onClose, onBooked }: AdminBookingModalProps) {
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

  return (
    <Modal open onClose={onClose} title={`新增預約：${enrollment.studentName}・${enrollment.programName}`}>
      {quotaStatus && (
        <div className="mb-3 rounded-lg bg-stripe px-3 py-2">
          <TutoringQuotaBar
            locked={quotaStatus.locked}
            upcoming={quotaStatus.upcoming}
            quota={quotaStatus.quota}
            pendingOverQuota={quotaStatus.pendingOverQuota}
            selectedCount={selectedCount}
          />
          {quotaStatus.upcomingBookings.length > 0 && (
            <p className="mt-1.5 text-xs text-inkMuted">
              已約日期：
              {quotaStatus.upcomingBookings
                .map((b) => `${formatDateWithWeekday(b.date)}${b.kind === 'MAKEUP' ? '（補課）' : ''}${b.status === 'PENDING_ADMIN' ? '（超額待審）' : ''}`)
                .join('、')}
            </p>
          )}
        </div>
      )}
      <TutoringBookingCalendar
        enrollmentId={enrollment.id}
        successMessage="已新增預約"
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
    </Modal>
  );
}
