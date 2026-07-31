import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPointReasons, createPointReason } from '@/lib/services/pointReasonService';

export async function GET() {
  const session = await getServerSession(authOptions);
  // TEACHER 也可讀：給點頁的理由下拉需要。寫入仍限 ADMIN。
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'TEACHER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPointReasons());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { label } = await req.json();
  const item = await createPointReason({ label });
  return NextResponse.json(item, { status: 201 });
}
