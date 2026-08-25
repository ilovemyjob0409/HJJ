import { describe, it, expect, beforeEach, vi } from 'vitest';

// 驗證「子任務其一拋錯其餘照跑」：把個輔缺席提醒 mock 成永遠拋錯
// 保留其餘實際 export（用 importOriginal）：makeupRequestService 內部會從這個
// module 取用 taipeiDateKey，若整包 mock 掉會連帶讓其餘三個子任務也失敗。
vi.mock('@/lib/services/tutoringBookingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/tutoringBookingService')>();
  return {
    ...actual,
    sendMissedSessionReminders: vi.fn().mockRejectedValue(new Error('boom')),
  };
});

import { GET } from './route';

function reqWithAuth(auth: string | null) {
  return { headers: { get: (name: string) => (name === 'authorization' ? auth : null) } } as never;
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
});

describe('GET /api/cron/daily-reminders', () => {
  it('403：無／錯誤 Bearer', async () => {
    expect((await GET(reqWithAuth(null))).status).toBe(403);
    expect((await GET(reqWithAuth('Bearer wrong'))).status).toBe(403);
  });

  it('子任務拋錯不影響其餘：個輔提醒 boom，三個補課任務照跑', async () => {
    const res = await GET(reqWithAuth('Bearer test-secret'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tutoringMissedSession).toEqual({ error: true });
    expect(data.makeupDayBefore).toEqual({ notified: 0 });
    expect(data.makeupNotFiled).toEqual({ notified: 0 });
    expect(data.pendingMakeupDigest).toEqual({ notified: false });
  });
});
