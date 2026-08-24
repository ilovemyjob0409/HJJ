import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { markRead } from '@/lib/services/notificationService';

// 單則標已讀（僅本人；已讀過再標＝冪等成功）
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    await markRead(params.id, session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'NOTIFICATION_NOT_FOUND' ? 404 : message === 'NOT_OWNER' ? 403 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
