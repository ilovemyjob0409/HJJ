'use client';

import { useEffect, useRef, useState } from 'react';
import { todayDateInput } from '@/components/AttendanceHub';

type CheckInResultKind = 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CHOOSE_SESSION' | 'ERROR';

interface CandidateOption {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  pendingAction: 'CHECK_IN' | 'CHECK_OUT';
}

interface CheckInResponse {
  result: CheckInResultKind;
  studentName?: string;
  sessionTitle?: string;
  time?: string;
  candidates?: CandidateOption[];
}

type ScreenState =
  | { kind: 'idle' }
  | { kind: 'result'; response: CheckInResponse }
  | { kind: 'picker'; code: string; studentName?: string; candidates: CandidateOption[] };

function nowTimeInput() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function resultTitle(r: CheckInResponse): string {
  if (r.result === 'CHECKED_IN') return `${r.studentName} 已簽到 ${r.time}`;
  if (r.result === 'CHECKED_OUT') return `${r.studentName} 已簽退 ${r.time}`;
  if (r.result === 'NOT_FOUND') return '查無此學號';
  if (r.result === 'ERROR') return '系統發生錯誤';
  return '找不到可報到的課程';
}

function resultSubtitle(r: CheckInResponse): string {
  if (r.result === 'CHECKED_IN' || r.result === 'CHECKED_OUT') return r.sessionTitle ?? '';
  if (r.result === 'ERROR') return '請洽行政人員（可能需要重新登入）';
  return '請洽行政人員';
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 6v12M11 6v12" />
    </svg>
  );
}

export default function CheckinKioskPage() {
  const [code, setCode] = useState('');
  const [screen, setScreen] = useState<ScreenState>({ kind: 'idle' });
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever a new scan/resolve starts or the picker times out, so a
  // slow request that finishes after being superseded can't clobber the
  // screen with a stale student's result.
  const requestIdRef = useRef(0);

  function focusInput() {
    inputRef.current?.focus();
  }

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    focusInput();
    return clearTimer;
  }, []);

  function showResult(response: CheckInResponse) {
    clearTimer();
    setScreen({ kind: 'result', response });
    timerRef.current = setTimeout(() => setScreen({ kind: 'idle' }), 4000);
  }

  async function submitCode(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setCode('');
    clearTimer();
    setResolvingKey(null);
    const requestId = ++requestIdRef.current;
    try {
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, date: todayDateInput(), time: nowTimeInput() }),
      });
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) {
        showResult({ result: 'ERROR' });
        return;
      }
      const data: CheckInResponse = await res.json();
      if (requestId !== requestIdRef.current) return;
      if (data.result === 'CHOOSE_SESSION' && data.candidates && data.candidates.length > 0) {
        setScreen({ kind: 'picker', code: trimmed, studentName: data.studentName, candidates: data.candidates });
        timerRef.current = setTimeout(() => {
          requestIdRef.current += 1;
          setScreen({ kind: 'idle' });
        }, 15000);
      } else {
        showResult(data);
      }
    } catch {
      if (requestId === requestIdRef.current) showResult({ result: 'ERROR' });
    }
  }

  async function resolveCandidate(pickerCode: string, key: string) {
    if (resolvingKey) return;
    // Once the user has picked a candidate, the picker's 15s abandonment
    // timeout must not fire mid-request — that would discard a response
    // that already wrote a real check-in/out, leaving staff unsure whether
    // the tap took effect.
    clearTimer();
    setResolvingKey(key);
    const requestId = ++requestIdRef.current;
    try {
      const res = await fetch('/api/attendance/checkin/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pickerCode, date: todayDateInput(), time: nowTimeInput(), key }),
      });
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) {
        showResult({ result: 'ERROR' });
        return;
      }
      const data: CheckInResponse = await res.json();
      if (requestId !== requestIdRef.current) return;
      showResult(data);
    } catch {
      if (requestId === requestIdRef.current) showResult({ result: 'ERROR' });
    } finally {
      if (requestId === requestIdRef.current) setResolvingKey(null);
    }
  }

  const isOkResult = screen.kind === 'result' && (screen.response.result === 'CHECKED_IN' || screen.response.result === 'CHECKED_OUT');

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-4">
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

      <div
        key={screen.kind}
        className="animate-fade-in flex w-full max-w-md flex-col items-center rounded-2xl border border-borderSubtle bg-card p-10 text-center shadow-md"
      >
        <div className="mb-4 text-xs font-extrabold tracking-widest text-brand">MUP</div>

        {screen.kind === 'idle' && (
          <>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brandInk">
              <ScanIcon />
            </div>
            <p className="text-xl font-semibold text-ink">請將學生證放在掃描器前</p>
            <p className="mt-1 text-sm text-inkMuted">掃描後會自動判斷今天的課程</p>
          </>
        )}

        {screen.kind === 'result' && (
          <>
            <div
              className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
                isOkResult ? 'bg-approvedBg text-approved' : 'bg-rejectedBg text-rejected'
              }`}
            >
              {isOkResult ? <CheckIcon /> : <XIcon />}
            </div>
            <p className={`text-xl font-semibold ${isOkResult ? 'text-approved' : 'text-rejected'}`}>{resultTitle(screen.response)}</p>
            <p className="mt-1 text-sm text-inkMuted">{resultSubtitle(screen.response)}</p>
          </>
        )}

        {screen.kind === 'picker' && (
          <>
            <p className="text-lg font-bold text-ink">{screen.studentName}，請選一堂課</p>
            <p className="mb-4 mt-1 text-xs text-inkMuted">15 秒內未選擇將自動返回待機畫面</p>
            <div className="flex w-full flex-col gap-2">
              {screen.candidates.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={resolvingKey !== null}
                  onClick={() => resolveCandidate(screen.code, c.key)}
                  className="flex items-center justify-between rounded-xl border border-borderSubtle bg-background px-4 py-3 text-left transition-colors hover:bg-stripe disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-bold text-ink">{c.title}</span>
                    <span className="block text-xs text-inkMuted">{c.timeLabel}</span>
                    {c.teacherName && <span className="block text-xs text-inkMuted">{c.teacherName}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${
                      c.pendingAction === 'CHECK_IN' ? 'bg-pendingBg text-pending' : 'bg-approvedBg text-approved'
                    }`}
                  >
                    {c.pendingAction === 'CHECK_IN' ? '待簽到' : '待簽退'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
