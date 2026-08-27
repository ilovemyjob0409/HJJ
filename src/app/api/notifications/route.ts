import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listNotifications, countUnread } from '@/lib/services/notificationService';

// 小鈴鐺收件夾：本人的最近通知＋未讀數（三端任何已登入角色）。
// ?countOnly=1 只回未讀數（1 個查詢）——鈴鐺掛載/切回分頁的徽章刷新用，
// 清單等打開面板才載，鈴鐺常態負載減半（2026-08-27 尖峰減載）。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (req.nextUrl.searchParams.get('countOnly')) {
    return NextResponse.json({ unread: await countUnread(session.user.id) });
  }
  const [unread, rows] = await Promise.all([countUnread(session.user.id), listNotifications(session.user.id)]);
  return NextResponse.json({ unread, rows });
}
