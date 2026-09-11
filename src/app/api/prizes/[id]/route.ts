import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updatePrize } from '@/lib/services/prizeService';

// 更新獎品業務錯誤碼白名單：只有這些訊息會原樣回傳給前端，其餘一律 500 INTERNAL（不外洩原始/Prisma 錯誤）。
const UPDATE_ERROR_CODES = new Set(['INVALID_NAME', 'INVALID_POINTS', 'INVALID_STOCK', 'INVALID_SORT_ORDER']);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json();
    if (
      (body?.name !== undefined && typeof body.name !== 'string') ||
      (body?.points !== undefined && typeof body.points !== 'number') ||
      (body?.stock !== undefined && typeof body.stock !== 'number') ||
      (body?.sortOrder !== undefined && typeof body.sortOrder !== 'number') ||
      (body?.active !== undefined && typeof body.active !== 'boolean')
    ) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const { name, points, stock, sortOrder, active } = body;
    return NextResponse.json(await updatePrize(params.id, { name, points, stock, sortOrder, active }));
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    const message = err instanceof Error ? err.message : '';
    if (message === 'NOT_FOUND') return NextResponse.json({ error: message }, { status: 404 });
    if (UPDATE_ERROR_CODES.has(message)) return NextResponse.json({ error: message }, { status: 422 });
    console.error('PATCH /api/prizes/[id] failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
