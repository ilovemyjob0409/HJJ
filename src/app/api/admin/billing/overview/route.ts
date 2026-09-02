import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { getBillingOverview } from '@/lib/services/billOverviewService';

// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD — 區間內（收費區間重疊）的已定案帳單總覽；
// start/end 都不帶＝不限期間（總覽預設），只帶其中一個視為缺欄位。
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  if (!!start !== !!end) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  const periodStart = start ? new Date(start) : undefined;
  const periodEnd = end ? new Date(end) : undefined;
  if ((periodStart && Number.isNaN(periodStart.getTime())) || (periodEnd && Number.isNaN(periodEnd.getTime()))) {
    return NextResponse.json({ error: 'INVALID_DATE' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getBillingOverview(periodStart, periodEnd));
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
