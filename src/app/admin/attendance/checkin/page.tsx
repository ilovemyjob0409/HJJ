'use client';

import { useEffect, useRef, useState } from 'react';
import { todayDateInput } from '@/components/AttendanceHub';

type CheckInResultKind = 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT' | 'ERROR';

interface CheckInResponse {
  result: CheckInResultKind;
  studentName?: string;
  sessionTitle?: string;
  time?: string;
}

function nowTimeInput() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const RESULT_STYLE: Record<CheckInResultKind, string> = {
  CHECKED_IN: 'text-approved',
  CHECKED_OUT: 'text-approved',
  NOT_FOUND: 'text-rejected',
  NO_SESSION: 'text-rejected',
  ERROR: 'text-rejected',
};

function resultMessage(r: CheckInResponse): string {
  if (r.result === 'CHECKED_IN') return `✓ ${r.studentName} 已簽到 ${r.time} — ${r.sessionTitle}`;
  if (r.result === 'CHECKED_OUT') return `✓ ${r.studentName} 已簽退 ${r.time} — ${r.sessionTitle}`;
  if (r.result === 'NOT_FOUND') return '查無此學號，請洽行政人員';
  if (r.result === 'ERROR') return '系統發生錯誤，請洽行政人員（可能需要重新登入）';
  return '找不到可報到的課程，請洽行政人員';
}

export default function CheckinKioskPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function focusInput() {
    inputRef.current?.focus();
  }

  useEffect(() => {
    focusInput();
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  async function submitCode(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setCode('');
    try {
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, date: todayDateInput(), time: nowTimeInput() }),
      });
      if (!res.ok) {
        setResult({ result: 'ERROR' });
      } else {
        const data: CheckInResponse = await res.json();
        setResult(data);
      }
    } catch {
      setResult({ result: 'ERROR' });
    }
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setResult(null), 4000);
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      <input
        ref={inputRef}
        aria-label="學生證掃描"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => setTimeout(focusInput, 0)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitCode(code);
          }
        }}
        className="absolute h-px w-px opacity-0"
      />
      {result ? (
        <p className={`text-4xl font-bold ${RESULT_STYLE[result.result]}`}>{resultMessage(result)}</p>
      ) : (
        <p className="text-3xl text-inkMuted">請將學生證放在掃描器前</p>
      )}
    </div>
  );
}
