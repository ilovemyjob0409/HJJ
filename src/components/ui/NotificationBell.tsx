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
  // 明確指定 h23：Safari 對 hour12: false 可能落在 h24（午夜顯示 24:05），
  // 正式站使用者主要用 Safari，這裡不能只靠引擎預設。
  hourCycle: 'h23',
});
const TAIPEI_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' });
const WEEKDAY_MAP: Record<string, string> = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

// 台北日曆日 key：分「今天／更早」用。通知的 createdAt 是真實時間戳，
// 不能用 dateFormat 的 isTodayTaipei（那是給 UTC 日曆日欄位用的，凌晨會分錯組）。
const TAIPEI_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function isTaipeiToday(createdAt: string): boolean {
  return TAIPEI_DAY_FMT.format(new Date(createdAt)) === TAIPEI_DAY_FMT.format(new Date());
}

// 依標題關鍵字配圖示與配色（純顯示用的啟發式：通知資料沒有型別欄位，
// 對不到的落回鈴鐺圖示）。比對順序有意義——「未核准」要先於「核准」。
const ICON_KINDS: { match: string[]; stroke: string; bg: string; icon: string }[] = [
  { match: ['未核准', '未通過', '駁回'], stroke: '#e2726b', bg: 'rgba(192,57,43,0.18)', icon: 'x' },
  { match: ['核准', '審核', '送審'], stroke: '#4fc07a', bg: 'rgba(30,122,70,0.2)', icon: 'check' },
  { match: ['簽到', '簽退'], stroke: '#7ea6e8', bg: 'rgba(44,95,187,0.22)', icon: 'clipboard' },
  { match: ['點數', '集點'], stroke: '#FFBD5A', bg: 'rgba(255,189,90,0.16)', icon: 'star' },
  { match: ['堂數', '堂票', '額度'], stroke: '#E8A94A', bg: 'rgba(232,169,74,0.16)', icon: 'alert' },
  { match: ['補課', '請假', '缺課', '缺席'], stroke: '#F2994A', bg: 'rgba(242,153,74,0.16)', icon: 'calendar' },
];

function notificationIcon(title: string): { stroke: string; bg: string; icon: string } {
  for (const kind of ICON_KINDS) {
    if (kind.match.some((m) => title.includes(m))) return kind;
  }
  return { stroke: '#b3a696', bg: 'rgba(179,166,150,0.14)', icon: 'bell' };
}

function IconGlyph({ icon }: { icon: string }) {
  switch (icon) {
    case 'x':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </>
      );
    case 'check':
      return (
        <>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      );
    case 'clipboard':
      return (
        <>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </>
      );
    case 'star':
      return <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />;
    case 'alert':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </>
      );
    default:
      return (
        <>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </>
      );
  }
}

// 「今天」的通知只顯示 HH:mm，其餘顯示完整 M/D（週N） HH:mm
function timeLabel(createdAt: string): string {
  if (!isTaipeiToday(createdAt)) return formatNotificationTime(createdAt);
  const parts = TAIPEI_TIME_FMT.formatToParts(new Date(createdAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

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
  const [loadingRows, setLoadingRows] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastLoadAtRef = useRef(0);

  async function load() {
    lastLoadAtRef.current = Date.now();
    setLoadingRows(true);
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setUnread(data.unread);
      setRows(data.rows);
    } finally {
      setLoadingRows(false);
    }
  }

  // 緊急止血（2026-08-27）：暫停自動查詢（掛載時抓一次＋切回分頁重抓），
  // 疑似造成正式站當機負載，先關閉背景查詢。未讀數僅在手動打開面板時才抓。
  // 之後若排除鈴鐺是主因，這段可以直接復原。

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
      if (!v) load().catch(() => {});
      return !v;
    });
  }

  // 逐則點擊已讀；有 url 就整頁導航（跨區塊導頁要吃到最新資料）
  async function clickRow(row: NotificationRow) {
    if (!row.readAt) {
      // 離線或暫時性錯誤不擋跳轉——已讀狀態下次載入會再對齊
      await fetch(`/api/notifications/${row.id}`, { method: 'PATCH' }).catch(() => {});
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
      await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
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
              <p className="px-3 py-6 text-center text-sm text-inkMuted">{loadingRows ? '載入中…' : '目前沒有通知'}</p>
            ) : (
              (() => {
                // 今天／更早分組＋跨組連續的斑馬紋（深淺相間比照 DataTable：
                // 奇數列 bg-stripe、偶數列 bg-card），未讀改由右側圓點＋不降透明度表達
                const todayRows = rows.filter((r) => isTaipeiToday(r.createdAt));
                const earlierRows = rows.filter((r) => !isTaipeiToday(r.createdAt));
                let zebra = 0;
                const renderRow = (row: NotificationRow) => {
                  const kind = notificationIcon(row.title);
                  const striped = zebra % 2 === 1;
                  zebra += 1;
                  return (
                    <button
                      key={row.id}
                      onClick={() => clickRow(row)}
                      className={`block w-full border-b border-borderSubtle px-3 py-2.5 text-left transition-[filter] last:border-b-0 hover:brightness-95 ${
                        striped ? 'bg-stripe' : 'bg-card'
                      } ${row.readAt ? 'opacity-70' : ''}`}
                    >
                      <span className="flex items-start gap-2.5">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                          style={{ backgroundColor: kind.bg }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={kind.stroke}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                          >
                            <IconGlyph icon={kind.icon} />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-grow">
                          <span className="block text-sm font-semibold text-ink">{row.title}</span>
                          <span className="block text-xs text-inkMuted">{row.body}</span>
                          <span className="mt-0.5 block text-[10px] text-inkMuted">{timeLabel(row.createdAt)}</span>
                        </span>
                        {!row.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pending" />}
                      </span>
                    </button>
                  );
                };
                return (
                  <>
                    {todayRows.length > 0 && (
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wider text-brandDark">今天</p>
                    )}
                    {todayRows.map(renderRow)}
                    {earlierRows.length > 0 && (
                      <p
                        className={`px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wider text-inkMuted ${
                          todayRows.length > 0 ? 'border-t border-borderSubtle' : ''
                        }`}
                      >
                        更早
                      </p>
                    )}
                    {earlierRows.map(renderRow)}
                  </>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
