import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { getBillingSetting, updateBillingSetting } from '@/lib/services/billingSettingService';
import { seedDefaultFeeTiers, listFeeTiers } from '@/lib/services/tutoringFeeTierService';
import { listDiscountItems } from '@/lib/services/discountItemService';

// 首次呼叫先種預設級距（表空時才建），再回設定＋級距清單＋優惠項目清單。
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    await seedDefaultFeeTiers();
    const [setting, feeTiers, discountItems] = await Promise.all([getBillingSetting(), listFeeTiers(), listDiscountItems()]);
    return NextResponse.json({ ...setting, feeTiers, discountItems });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    await updateBillingSetting({
      deductionCap: body.deductionCap,
      paymentInfo: body.paymentInfo,
      goHallTicketPrice: body.goHallTicketPrice,
      goHallSeasonPassPrice: body.goHallSeasonPassPrice,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
