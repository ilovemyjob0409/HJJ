import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { markAllRead } from '@/lib/services/notificationService';

// 一鍵已讀（使用者明確要求的按鈕）
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await markAllRead(session.user.id);
  return NextResponse.json({ success: true });
}
