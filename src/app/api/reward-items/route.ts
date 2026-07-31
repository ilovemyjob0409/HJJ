import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listRewardItems, createRewardItem } from '@/lib/services/rewardItemService';

export async function GET() {
  const session = await getServerSession(authOptions);
  // 目錄對所有登入角色開放（學生頁另走 service，這裡主要給後台用）。
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listRewardItems());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { name, pointsCost } = await req.json();
  try {
    const item = await createRewardItem({ name, pointsCost });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
