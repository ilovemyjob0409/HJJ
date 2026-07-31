import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { movePointReason, listPointReasons } from '@/lib/services/pointReasonService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { direction } = await req.json();
  await movePointReason(params.id, direction);
  return NextResponse.json(await listPointReasons());
}
