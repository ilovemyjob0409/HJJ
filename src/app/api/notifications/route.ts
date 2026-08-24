import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listNotifications, countUnread } from '@/lib/services/notificationService';

// 小鈴鐺收件夾：本人的最近通知＋未讀數（三端任何已登入角色）
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [unread, rows] = await Promise.all([countUnread(session.user.id), listNotifications(session.user.id)]);
  return NextResponse.json({ unread, rows });
}
