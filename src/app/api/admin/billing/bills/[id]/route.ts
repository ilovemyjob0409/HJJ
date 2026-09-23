import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiGuards';
import { prisma } from '@/lib/db';
import { updateDraftBill, deleteBill } from '@/lib/services/billingBatchService';
import { updateFinalizedBill } from '@/lib/services/billEditService';
import { updateGoHallBill, deleteGoHallBill } from '@/lib/services/goHallBillService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    // 依帳單狀態分流：草稿走批次頁的草稿編輯，已定案走未繳帳單編輯（優惠／堂數連動）；
    // 弈廳帳單（goHallItem 非 null）另走 updateGoHallBill（堂票／季票連動扣回）。
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: params.id }, select: { status: true, goHallItem: true } });
    if (bill.goHallItem !== null) {
      const startDate = body.startDate ? new Date(body.startDate) : undefined;
      const endDate = body.endDate ? new Date(body.endDate) : undefined;
      if ((startDate && isNaN(startDate.getTime())) || (endDate && isNaN(endDate.getTime()))) {
        return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
      }
      await updateGoHallBill(params.id, {
        amountDue: body.amountDue,
        discounts: body.discounts ?? [],
        sessions: body.goHallTickets,
        unitPrice: body.unitPrice,
        startDate,
        endDate,
        price: body.price,
      });
      return NextResponse.json({ success: true });
    }
    if (bill.status === 'FINALIZED') {
      await updateFinalizedBill(params.id, {
        billedSessions: body.billedSessions,
        amountDue: body.amountDue,
        discounts: body.discounts ?? [],
      });
      return NextResponse.json({ success: true });
    }
    await updateDraftBill(params.id, {
      billedSessions: body.billedSessions,
      amountDue: body.amountDue,
      note: body.note,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: params.id }, select: { goHallItem: true } });
    if (bill.goHallItem !== null) await deleteGoHallBill(params.id);
    else await deleteBill(params.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
