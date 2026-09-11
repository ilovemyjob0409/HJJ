import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listPrizesForStudent, listPrizesForAdmin, createPrize } from '@/lib/services/prizeService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'ADMIN') return NextResponse.json(await listPrizesForAdmin());
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await listPrizesForStudent(student.id));
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// 新增獎品業務錯誤碼白名單：只有這些訊息會原樣回傳給前端，其餘一律 500 INTERNAL（不外洩原始/Prisma 錯誤）。
const CREATE_ERROR_CODES = new Set(['INVALID_NAME', 'INVALID_POINTS', 'INVALID_STOCK', 'INVALID_SORT_ORDER']);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json();
    if (
      typeof body?.name !== 'string' ||
      typeof body?.points !== 'number' ||
      typeof body?.stock !== 'number' ||
      typeof body?.sortOrder !== 'number'
    ) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const { name, points, stock, sortOrder } = body;
    return NextResponse.json(await createPrize({ name, points, stock, sortOrder }), { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    const message = err instanceof Error ? err.message : '';
    if (CREATE_ERROR_CODES.has(message)) return NextResponse.json({ error: message }, { status: 422 });
    console.error('POST /api/prizes failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
