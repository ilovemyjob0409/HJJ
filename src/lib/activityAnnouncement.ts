import { formatTimestampWithWeekdayTaipei } from './dateFormat';

// 活動手動推播的共用常數：前端彈窗與 API 驗證共用，刻意不 import 任何
// server-only 模組（Prisma 等），'use client' 元件才能直接引用。
export const ANNOUNCEMENT_MAX_LENGTH = 200;

export const ANNOUNCEMENT_AUDIENCES = ['REGISTERED', 'ALL_STUDENTS'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export function isAnnouncementAudience(v: unknown): v is AnnouncementAudience {
  return typeof v === 'string' && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(v);
}

export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  REGISTERED: '已報名學生',
  ALL_STUDENTS: '全體學生',
};

// hourCycle 明確指定 h23（Safari 的 hour12:false 可能落 h24）；用 formatToParts
// 組字，不依賴 zh-TW format() 的分隔字元
const TAIPEI_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatAnnouncementTime(date: Date | string): string {
  const parts = TAIPEI_TIME_FMT.formatToParts(new Date(date));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${formatTimestampWithWeekdayTaipei(date)} ${get('hour')}:${get('minute')}`;
}
