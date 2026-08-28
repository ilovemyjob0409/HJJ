import { NextRequest, NextResponse } from 'next/server';
import { sendMissedSessionReminders } from '@/lib/services/tutoringBookingService';
import {
  sendMakeupDayBeforeReminders,
  sendMakeupNotFiledReminders,
  sendPendingMakeupDigest,
} from '@/lib/services/makeupRequestService';
import { refreshNationalHolidaysFromDGPA } from '@/lib/services/closedDayService';

// 每日提醒總路由（Vercel 免費方案 cron 上限 2 個，所有每日任務併在這裡，
// 每天台北 09:00 跑一次）。子任務彼此獨立：任一失敗記 log 後其餘照跑。
// 五個子任務循序跑在同一次呼叫，給足執行時間避免預設逾時砍掉後段任務
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // CRON_SECRET 沒設時直接拒絕——否則 `Bearer undefined` 會意外通過驗證
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const jobs: [string, () => Promise<unknown>][] = [
    ['tutoringMissedSession', () => sendMissedSessionReminders()],
    ['makeupDayBefore', () => sendMakeupDayBeforeReminders()],
    ['makeupNotFiled', () => sendMakeupNotFiledReminders()],
    ['pendingMakeupDigest', () => sendPendingMakeupDigest()],
    ['nationalHolidaysRefresh', () => refreshNationalHolidaysFromDGPA()],
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
