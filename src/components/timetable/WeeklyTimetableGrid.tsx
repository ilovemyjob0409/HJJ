'use client';

import { useEffect, useMemo, useState } from 'react';
import { stripWeekday, levelColor, UNSET_SUBJECT_COLOR } from '@/lib/timetable';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

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

interface TutoringSlot {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

type DayCard = { kind: 'class'; data: TimetableClass } | { kind: 'tutoring'; data: TutoringSlot };

// School is closed Sunday (0) and Monday (1); only render Tue-Sat.
const OPEN_WEEKDAYS = [2, 3, 4, 5, 6];

interface WeeklyTimetableGridProps {
  colors: Record<string, string>;
  onClassClick?: (id: string) => void;
  onSubjectsChange?: (subjects: string[]) => void;
}

export default function WeeklyTimetableGrid({ colors, onClassClick, onSubjectsChange }: WeeklyTimetableGridProps) {
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [tutoringSlots, setTutoringSlots] = useState<TutoringSlot[]>([]);

  useEffect(() => {
    fetch('/api/timetable')
      .then((res) => (res.ok ? res.json() : { classes: [], tutoringSlots: [] }))
      .then((data: { classes: TimetableClass[]; tutoringSlots: TutoringSlot[] }) => {
        setClasses(data.classes);
        setTutoringSlots(data.tutoringSlots);
      })
      .catch(() => {
        setClasses([]);
        setTutoringSlots([]);
      });
  }, []);

  const subjects = useMemo(
    () => Array.from(new Set([...classes.map((c) => c.subject), ...tutoringSlots.map((t) => t.programName)])),
    [classes, tutoringSlots]
  );

  useEffect(() => {
    onSubjectsChange?.(subjects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects]);

  const byDay = useMemo(() => {
    const days: DayCard[][] = Array.from({ length: 7 }, () => []);
    for (const c of classes) days[c.weekday].push({ kind: 'class', data: c });
    for (const t of tutoringSlots) days[t.weekday].push({ kind: 'tutoring', data: t });
    for (const day of days) day.sort((a, b) => a.data.startTime.localeCompare(b.data.startTime));
    return days;
  }, [classes, tutoringSlots]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px] rounded-xl bg-brand p-5">
        <div className="mb-4 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hjj-logo.png" alt="黑嘉嘉圍棋" className="mb-1.5 h-20 w-auto" />
          <p className="text-sm font-bold text-brandInk">台中大雅分校</p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {OPEN_WEEKDAYS.map((wd) => (
            <div key={wd} className="flex justify-center pb-1">
              <span className="flex h-6 min-w-[40px] items-center justify-center rounded-full bg-brandInk px-2.5 text-xs font-bold text-brand">
                {WEEKDAY_LABELS[wd]}
              </span>
            </div>
          ))}
          {OPEN_WEEKDAYS.map((wd) => {
            const day = byDay[wd];
            return (
            <div key={wd} className="flex min-h-[90px] flex-col gap-1.5 rounded-lg bg-[#FFF6E6] p-1.5">
              {day.length === 0 ? (
                <p className="pt-3 text-center text-xs text-[#b89a5c]">無課程</p>
              ) : (
                day.map((card) => {
                  if (card.kind === 'tutoring') {
                    return (
                      <div
                        key={card.data.id}
                        className="overflow-hidden rounded-md py-1.5 pl-2 pr-2 text-left"
                        style={{ background: colors[card.data.programName] ?? UNSET_SUBJECT_COLOR }}
                      >
                        <p className="text-xs font-bold text-brandInk">{card.data.programName}</p>
                        <p className="mt-0.5 text-[11px] text-brandInk/80">
                          {card.data.startTime}-{card.data.endTime}
                        </p>
                        <p className="text-[10px] text-brandInk/60">{card.data.teacher.user.name}</p>
                      </div>
                    );
                  }
                  const content = (
                    <>
                      <span
                        className="absolute bottom-0 right-0 top-0 w-2.5"
                        style={{ background: levelColor(card.data.level) }}
                      />
                      <p className="text-xs font-bold text-brandInk">{stripWeekday(card.data.name)}</p>
                      <p className="mt-0.5 text-[11px] text-brandInk/80">
                        {card.data.startTime}-{card.data.endTime}
                      </p>
                      <p className="text-[10px] text-brandInk/60">
                        {card.data.teacher.user.name}・{card.data.level}
                      </p>
                    </>
                  );
                  const cardClassName = 'relative overflow-hidden rounded-md py-1.5 pl-2 pr-4 text-left';
                  const cardStyle = { background: colors[card.data.subject] ?? UNSET_SUBJECT_COLOR };
                  return onClassClick ? (
                    <button
                      key={card.data.id}
                      type="button"
                      onClick={() => onClassClick(card.data.id)}
                      className={`${cardClassName} transition-[filter] hover:brightness-110`}
                      style={cardStyle}
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={card.data.id} className={cardClassName} style={cardStyle}>
                      {content}
                    </div>
                  );
                })
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
