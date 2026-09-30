'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import {
  ANNOUNCEMENT_MAX_LENGTH,
  AUDIENCE_LABEL,
  AnnouncementAudience,
  formatAnnouncementTime,
} from '@/lib/activityAnnouncement';

interface AnnouncementRow {
  id: string;
  createdAt: string;
  audience: AnnouncementAudience;
  includeTeachers: boolean;
  message: string;
  recipientCount: number;
  sender: { name: string };
}

interface ActivityAnnouncementsProps {
  activityId: string;
  registeredCount: number;
  teacherCount: number;
  allStudentCount: number;
}

const ERROR_TEXT: Record<string, string> = {
  INVALID_INPUT: '資料格式錯誤，請重新整理後再試',
  INVALID_AUDIENCE: '請選擇通知對象',
  MESSAGE_REQUIRED: '請輸入通知內容',
  MESSAGE_TOO_LONG: `通知內容不可超過 ${ANNOUNCEMENT_MAX_LENGTH} 字`,
  NOT_FOUND: '找不到這個活動，請重新整理',
  NO_RECIPIENTS: '沒有可通知的對象',
};

const columns: Column<AnnouncementRow>[] = [
  { header: '時間', render: (r) => formatAnnouncementTime(r.createdAt), sortValue: (r) => r.createdAt, width: 'w-44' },
  { header: '發送人', render: (r) => r.sender.name, width: 'w-24' },
  { header: '對象', render: (r) => `${AUDIENCE_LABEL[r.audience]}${r.includeTeachers ? '＋老師' : ''}`, width: 'w-32' },
  { header: '內容', render: (r) => <span className="whitespace-pre-wrap break-words">{r.message}</span> },
  { header: '人數', render: (r) => r.recipientCount, sortValue: (r) => r.recipientCount, width: 'w-16' },
];

// 行政端活動詳情的「通知紀錄」區塊：列出手動推播紀錄，並提供發送彈窗
export default function ActivityAnnouncements({
  activityId,
  registeredCount,
  teacherCount,
  allStudentCount,
}: ActivityAnnouncementsProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<AnnouncementAudience>('REGISTERED');
  const [includeTeachers, setIncludeTeachers] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // stale guard：切換活動或重抓時，舊請求晚回來不得蓋掉新資料
    let cancelled = false;
    fetch(`/api/activities/${activityId}/announcements`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AnnouncementRow[]) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, refreshKey]);

  const studentCount = audience === 'ALL_STUDENTS' ? allStudentCount : registeredCount;
  const total = studentCount + (includeTeachers ? teacherCount : 0);

  function openModal() {
    setAudience('REGISTERED');
    setIncludeTeachers(false);
    setMessage('');
    setError('');
    setOpen(true);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/activities/${activityId}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, includeTeachers, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_TEXT[data.error] ?? '發送失敗，請稍後再試');
        return;
      }
      showToast(`已通知 ${data.recipientCount} 人`);
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-inkMuted">通知紀錄（{rows.length}）</h3>
        <Button type="button" variant="link" className="text-xs" onClick={openModal}>
          發送通知
        </Button>
      </div>
      <CollapsibleDataTable
        columns={columns}
        rows={rows}
        keyField={(r) => r.id}
        maxRows={3}
        loading={loading}
        emptyText="尚未發送過通知"
      />

      <Modal open={open} onClose={() => setOpen(false)} title="發送活動通知">
        <form onSubmit={handleSend} className="flex flex-col gap-3">
          <div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={ANNOUNCEMENT_MAX_LENGTH}
              placeholder="例：明天記得帶水壺"
              aria-label="通知內容"
              className="w-full"
            />
            <p className="mt-1 text-right text-xs text-inkMuted">
              {message.length}/{ANNOUNCEMENT_MAX_LENGTH}
            </p>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-ink">通知對象</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="audience" checked={audience === 'REGISTERED'} onChange={() => setAudience('REGISTERED')} />
              已報名學生（{registeredCount} 人）
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="audience" checked={audience === 'ALL_STUDENTS'} onChange={() => setAudience('ALL_STUDENTS')} />
              全體學生（{allStudentCount} 人）
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={includeTeachers} onChange={(e) => setIncludeTeachers(e.target.checked)} />
            同時通知帶隊老師（{teacherCount} 位）
          </label>
          {error && <p className="text-sm text-rejected">{error}</p>}
          <Button type="submit" loading={sending} disabled={total === 0 || !message.trim()}>
            發送給 {total} 人
          </Button>
        </form>
      </Modal>
    </div>
  );
}
