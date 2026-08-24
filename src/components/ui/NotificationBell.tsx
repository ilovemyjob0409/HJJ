'use client';

import { useEffect, useRef, useState } from 'react';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

const TAIPEI_TIME_FMT = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const TAIPEI_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' });
const WEEKDAY_MAP: Record<string, string> = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

// 通知時間顯示：M/D（週N） HH:mm，固定台北時區（DB 存 UTC timestamp）。
// 用 formatToParts 組字串——zh-TW 的 format() 在日期與時間之間插的是
// U+2009 窄空格，不能用一般空白 split。
function formatNotificationTime(createdAt: string): string {
  const d = new Date(createdAt);
  const parts = TAIPEI_TIME_FMT.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = WEEKDAY_MAP[TAIPEI_WEEKDAY_FMT.format(d)] ?? '';
  return `${get('month')}/${get('day')}（${weekday}）${get('hour')}:${get('minute')}`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [marking, setMarking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    const data = await res.json();
    setUnread(data.unread);
    setRows(data.rows);
  }

  // 掛載時抓一次；回到分頁時重抓（不輪詢）
  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // 點面板外或按 Esc 關閉
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle() {
    setOpen((v) => {
      if (!v) load();
      return !v;
    });
  }

  // 逐則點擊已讀；有 url 就整頁導航（跨區塊導頁要吃到最新資料）
  async function clickRow(row: NotificationRow) {
    if (!row.readAt) {
      await fetch(`/api/notifications/${row.id}`, { method: 'PATCH' });
    }
    if (row.url) {
      window.location.href = row.url;
      return;
    }
    load();
  }

  // 使用者明確要求的「一鍵已讀」
  async function markAll() {
    if (unread === 0 || marking) return;
    setMarking(true);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      await load();
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        aria-label="通知"
        className="relative flex cursor-pointer items-center p-1 text-inkMuted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rejected px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-80 max-w-[90vw] rounded-lg border border-borderStrong bg-card shadow-md">
          <div className="flex items-center justify-between border-b border-borderSubtle px-3 py-2">
            <p className="text-sm font-semibold text-ink">通知</p>
            <button
              onClick={markAll}
              disabled={unread === 0 || marking}
              className="cursor-pointer text-xs text-inkMuted hover:text-ink disabled:cursor-default disabled:opacity-50"
            >
              全部標為已讀
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-inkMuted">目前沒有通知</p>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => clickRow(row)}
                  className={`block w-full border-b border-borderSubtle px-3 py-2 text-left last:border-b-0 hover:bg-stripe ${
                    row.readAt ? '' : 'bg-stripe/60'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    {!row.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pending" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{row.title}</span>
                      <span className="block text-xs text-inkMuted">{row.body}</span>
                      <span className="mt-0.5 block text-[10px] text-inkMuted">{formatNotificationTime(row.createdAt)}</span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
