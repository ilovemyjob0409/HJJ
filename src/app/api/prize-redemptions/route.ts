import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  redeemPrize,
  listMyRedemptions,
  listPendingRedemptions,
} from '@/lib/services/prizeService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'ADMIN') {
    return NextResponse.json(await listPendingRedemptions());
  }
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await listMyRedemptions(student.id));
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// 兌換業務錯誤碼白名單：只有這些訊息會原樣回傳給前端，其餘一律 500 INTERNAL（不外洩原始/Prisma 錯誤）。
const REDEEM_ERROR_CODES = new Set(['PRIZE_UNAVAILABLE', 'OUT_OF_STOCK', 'ALREADY_REDEEMED', 'INSUFFICIENT_POINTS']);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json();
    if (typeof body?.prizeId !== 'string' || !body.prizeId) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const result = await redeemPrize({ studentId: student.id, prizeId: body.prizeId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    const message = err instanceof Error ? err.message : '';
    if (REDEEM_ERROR_CODES.has(message)) return NextResponse.json({ error: message }, { status: 422 });
    console.error('POST /api/prize-redemptions failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
