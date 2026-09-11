import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updatePrize } from '@/lib/services/prizeService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { name, points, stock, sortOrder, active } = await req.json();
  try {
    return NextResponse.json(await updatePrize(params.id, { name, points, stock, sortOrder, active }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
