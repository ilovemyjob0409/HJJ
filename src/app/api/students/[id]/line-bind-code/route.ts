import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateBindCode } from '@/lib/services/lineService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const result = await generateBindCode(params.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'LINE_OA_BASIC_ID_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'LINE_OA_BASIC_ID_NOT_CONFIGURED' }, { status: 500 });
    }
    throw err;
  }
}
