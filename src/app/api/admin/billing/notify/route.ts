import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { notifyBills } from '@/lib/services/billNotifyService';

// 逐筆帳單發送通知，給足執行時間避免預設逾時砍掉後段
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.billIds) || body.billIds.length === 0) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }
  try {
    await notifyBills(body.billIds);
    return NextResponse.json({ success: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
