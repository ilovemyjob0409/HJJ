// 活動手動推播的共用常數：前端彈窗與 API 驗證共用，刻意不 import 任何
// server-only 模組（Prisma 等），'use client' 元件才能直接引用。
export const ANNOUNCEMENT_MAX_LENGTH = 200;

export const ANNOUNCEMENT_AUDIENCES = ['REGISTERED', 'ALL_STUDENTS'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export function isAnnouncementAudience(v: unknown): v is AnnouncementAudience {
  return typeof v === 'string' && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(v);
}
