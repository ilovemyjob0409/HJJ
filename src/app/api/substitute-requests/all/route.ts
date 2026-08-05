import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listAllSubstituteRequests } from '@/lib/services/substituteRequestService';

// 「代課安排」頁的「安排代課紀錄」總表：全部代課申請（含待安排／已指派）。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listAllSubstituteRequests());
}
