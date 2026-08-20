import { NextRequest, NextResponse } from 'next/server';
import { sendMissedSessionReminders } from '@/lib/services/tutoringBookingService';

// Vercel Cron 呼叫時會帶 Authorization: Bearer $CRON_SECRET。每天早上檢查
// 昨天未取消也未點名的個輔預約，推播提醒家長改約。
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const result = await sendMissedSessionReminders();
  return NextResponse.json(result);
}
