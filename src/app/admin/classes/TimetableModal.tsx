'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { stripWeekday, levelColor, UNSET_SUBJECT_COLOR } from '@/lib/timetable';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TimetableClass {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

interface TimetableModalProps {
  open: boolean;
  onClose: () => void;
  classes: TimetableClass[];
}

export default function TimetableModal({ open, onClose, classes }: TimetableModalProps) {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/subject-colors')
      .then((res) => res.json())
      .then((rows: { subject: string; color: string }[]) => {
        setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color])));
      });
  }, [open]);

  const subjects = useMemo(() => Array.from(new Set(classes.map((c) => c.subject))), [classes]);

  const byDay = useMemo(() => {
    const days: TimetableClass[][] = Array.from({ length: 7 }, () => []);
    for (const c of classes) days[c.weekday].push(c);
    for (const day of days) day.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return days;
  }, [classes]);

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
              <div key={subject} className="flex items-center gap-2 py-1 text-sm text-ink">
                <span className="w-20 font-medium">{subject}</span>
                <input
                  type="color"
                  value={colors[subject] ?? UNSET_SUBJECT_COLOR}
                  onChange={(e) => handleColorChange(subject, e.target.value)}
                  className="h-6 w-6 cursor-pointer border-none bg-transparent p-0"
                />
                {!colors[subject] && (
                  <span className="rounded-full bg-pendingBg px-2 py-0.5 text-xs text-pending">尚未設定</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[840px] grid-cols-7 bg-card p-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="flex justify-center pb-2">
              <span className="flex h-6 min-w-[40px] items-center justify-center rounded-full bg-brand px-2.5 text-xs font-bold text-brandInk">
                {w}
              </span>
            </div>
          ))}
          {byDay.map((day, d) => (
            <div
              key={d}
              className={`flex min-h-[90px] flex-col gap-1.5 rounded-lg px-1.5 pb-2 pt-1 ${d % 2 === 1 ? 'bg-stripe' : ''}`}
            >
              {day.length === 0 ? (
                <p className="pt-3 text-center text-xs text-inkMuted">無課程</p>
              ) : (
                day.map((c) => (
                  <div
                    key={c.id}
                    className="relative overflow-hidden rounded-md py-1.5 pl-2 pr-3.5"
                    style={{ background: colors[c.subject] ?? UNSET_SUBJECT_COLOR }}
                  >
                    <span
                      className="absolute bottom-0 right-0 top-0 w-1.5"
                      style={{ background: levelColor(c.level) }}
                    />
                    <p className="text-xs font-bold text-white">{stripWeekday(c.name)}</p>
                    <p className="mt-0.5 text-[11px] text-white/85">
                      {c.startTime}-{c.endTime}
                    </p>
                    <p className="text-[10px] text-white/70">
                      {c.teacher.user.name}・{c.level}
                    </p>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
