import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { movePrizeRuleItem, listPrizeRuleItems } from '@/lib/services/prizeRuleService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { direction } = await req.json();
  await movePrizeRuleItem(params.id, direction);
  return NextResponse.json(await listPrizeRuleItems());
}
