import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listAllLeaveRequests } from '@/lib/services/leaveRequestService';

// 行政「請假管理」總表：全部請假申請（學生自請＋行政代辦）。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listAllLeaveRequests());
}
