'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import type { ClassBacklogItem } from '@/lib/services/makeupBacklogService';

export type BacklogGroup = { title: string; items: { date: string; label: string }[]; note?: string };

export function classItemLabel(item: ClassBacklogItem): string {
  if (item.reason === 'ABSENT') return '缺席';
  return item.makeupPending ? '請假（補課待審）' : '請假';
}

// 未補堂數標籤：>0 橘色可點（開明細彈窗），0 顯示灰色「—」。
// 放在可點擊的表格列裡時要擋掉冒泡，避免同時觸發列展開。
export default function MakeupBacklogBadge({
  count,
  modalTitle,
  groups,
  className = '',
}: {
  count: number;
  modalTitle: string;
  groups: BacklogGroup[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (count <= 0) return <span className={`text-inkMuted ${className}`}>—</span>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`whitespace-nowrap rounded-full bg-pendingBg px-2.5 py-0.5 text-xs font-semibold text-pending transition-opacity hover:opacity-80 ${className}`}
      >
        {count} 堂
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={modalTitle} maxWidthClassName="max-w-sm">
        <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          {groups.map((g) => (
            <div key={g.title}>
              {groups.length > 1 && <p className="mb-1 text-sm font-semibold text-ink">{g.title}</p>}
              {g.note && <p className="mb-1 text-xs text-inkMuted">{g.note}</p>}
              <ul className="flex flex-col">
                {g.items.map((it) => (
                  <li key={it.date} className="flex justify-between border-b border-borderSubtle py-1.5 text-sm last:border-b-0">
                    <span className="text-ink">{formatDateWithWeekday(it.date)}</span>
                    <span className="text-inkMuted">{it.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
