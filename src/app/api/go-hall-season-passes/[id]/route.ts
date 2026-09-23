import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteSeasonPass } from '@/lib/services/goHallTicketService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteSeasonPass(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 422 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
