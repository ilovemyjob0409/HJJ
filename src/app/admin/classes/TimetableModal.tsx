'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import WeeklyTimetableGrid from '@/components/timetable/WeeklyTimetableGrid';
import { UNSET_SUBJECT_COLOR, MORANDI_PALETTE } from '@/lib/timetable';

interface TimetableModalProps {
  open: boolean;
  onClose: () => void;
  onClassClick?: (id: string) => void;
}

export default function TimetableModal({ open, onClose, onClassClick }: TimetableModalProps) {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/subject-colors')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: { subject: string; color: string }[]) => {
        setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color])));
      })
      .catch(() => setColors({}));
  }, [open]);

  async function handleColorChange(subject: string, color: string) {
    setColors((prev) => ({ ...prev, [subject]: color }));
    await fetch('/api/subject-colors', { method: 'POST', body: JSON.stringify({ subject, color }) });
  }

  return (
    <Modal open={open} onClose={onClose} title="週課表" maxWidthClassName="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink">
          {subjects.map((subject) => (
            <span key={subject} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colors[subject] ?? UNSET_SUBJECT_COLOR }}
              />
              {subject}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brandInk hover:bg-brandDark"
        >
          色塊調整
        </button>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: panelOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mb-3 rounded-lg bg-stripe p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold text-ink">科目顏色</span>
              <button
                type="button"
                className="text-xs text-inkMuted hover:underline"
                onClick={() => setPanelOpen(false)}
              >
                收合
              </button>
            </div>
            {subjects.map((subject) => (
              <div key={subject} className="flex flex-wrap items-center gap-2 py-1.5 text-sm text-ink">
                <span className="w-20 font-medium">{subject}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {MORANDI_PALETTE.map((color) => {
                    const selected = colors[subject] === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        aria-label={`${subject}：${color}`}
                        onClick={() => handleColorChange(subject, color)}
                        className={`h-6 w-6 rounded-md transition-[transform,box-shadow] ${
                          selected ? 'scale-110 ring-2 ring-ink ring-offset-1' : 'hover:scale-110'
                        }`}
                        style={{ background: color }}
                      />
                    );
                  })}
                </div>
                {!colors[subject] && (
                  <span className="rounded-full bg-pendingBg px-2 py-0.5 text-xs text-pending">尚未設定</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <WeeklyTimetableGrid colors={colors} onClassClick={onClassClick} onSubjectsChange={setSubjects} />
    </Modal>
  );
}
