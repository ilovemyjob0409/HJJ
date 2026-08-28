import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { getBillingSetting, updateBillingSetting } from '@/lib/services/billingSettingService';
import { seedDefaultFeeTiers, listFeeTiers } from '@/lib/services/tutoringFeeTierService';

// 首次呼叫先種預設級距（表空時才建），再回設定＋級距清單。
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await seedDefaultFeeTiers();
  const [setting, feeTiers] = await Promise.all([getBillingSetting(), listFeeTiers()]);
  return NextResponse.json({ ...setting, feeTiers });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    await updateBillingSetting({ deductionCap: body.deductionCap, paymentInfo: body.paymentInfo });
    return NextResponse.json({ success: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
