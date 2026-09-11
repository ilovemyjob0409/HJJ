import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  redeemPrize,
  listMyRedemptions,
  listPendingRedemptions,
} from '@/lib/services/prizeService';

export async function GET(_req: NextRequest) {
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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { prizeId } = await req.json();
  try {
    const result = await redeemPrize({ studentId: student.id, prizeId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
