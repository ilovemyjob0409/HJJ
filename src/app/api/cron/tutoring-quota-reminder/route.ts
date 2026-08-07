import { NextRequest, NextResponse } from 'next/server';
import { sendMonthlyQuotaReminders } from '@/lib/services/tutoringBookingService';

// Vercel Cron 呼叫時會帶 Authorization: Bearer $CRON_SECRET（見 Task 18 的 vercel.json）。
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const result = await sendMonthlyQuotaReminders();
  return NextResponse.json(result);
}
