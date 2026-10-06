import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { remindBills } from '@/lib/services/billNotifyService';

// 逐筆帳單發送提醒，給足執行時間避免預設逾時砍掉後段
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.billIds) || body.billIds.length === 0 || !body.billIds.every((id: unknown) => typeof id === 'string')) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }
  try {
    const result = await remindBills(body.billIds);
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
