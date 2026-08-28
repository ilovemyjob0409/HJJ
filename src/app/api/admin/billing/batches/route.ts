import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { listBatches, createClassBatch, createTutoringBatch } from '@/lib/services/billingBatchService';

// 建立整批帳單時每筆列（班級/報名）逐一序列查詢，給足執行時間避免預設逾時砍掉後段
export const maxDuration = 60;

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await listBatches());
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.kind || !body.periodStart || !body.periodEnd) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  try {
    const input = { periodStart: new Date(body.periodStart), periodEnd: new Date(body.periodEnd) };
    const result = body.kind === 'CLASS'
      ? await createClassBatch({ ...input, classIds: body.classIds ?? [] })
      : await createTutoringBatch({ ...input, programIds: body.programIds ?? [] });
    return NextResponse.json(result);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
