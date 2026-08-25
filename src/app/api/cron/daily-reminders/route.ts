import { NextRequest, NextResponse } from 'next/server';
import { sendMissedSessionReminders } from '@/lib/services/tutoringBookingService';
import {
  sendMakeupDayBeforeReminders,
  sendMakeupNotFiledReminders,
  sendPendingMakeupDigest,
} from '@/lib/services/makeupRequestService';

// 每日提醒總路由（Vercel 免費方案 cron 上限 2 個，所有每日任務併在這裡，
// 每天台北 09:00 跑一次）。子任務彼此獨立：任一失敗記 log 後其餘照跑。
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const jobs: [string, () => Promise<unknown>][] = [
    ['tutoringMissedSession', () => sendMissedSessionReminders()],
    ['makeupDayBefore', () => sendMakeupDayBeforeReminders()],
    ['makeupNotFiled', () => sendMakeupNotFiledReminders()],
    ['pendingMakeupDigest', () => sendPendingMakeupDigest()],
  ];
  const results: Record<string, unknown> = {};
  for (const [name, run] of jobs) {
    try {
      results[name] = await run();
    } catch (err) {
      console.error(`daily reminder job ${name} failed`, err);
      results[name] = { error: true };
    }
  }
  return NextResponse.json(results);
}
