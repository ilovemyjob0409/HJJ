import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listOneOnOneSlotOptions } from '@/lib/services/makeupRequestService';

// 指定老師＋日期的一對一可預約起點（40 分鐘格；被佔用標記不可選）。
// 只回時間，不含預約者資訊；學生表單與行政代排共用。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const teacherId = req.nextUrl.searchParams.get('teacherId');
  const date = req.nextUrl.searchParams.get('date');
  if (!teacherId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }
  return NextResponse.json(await listOneOnOneSlotOptions(teacherId, new Date(date)));
}
