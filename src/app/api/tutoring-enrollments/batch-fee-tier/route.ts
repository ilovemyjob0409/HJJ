import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { batchSetFeeTier } from '@/lib/services/tutoringFeeTierService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentIds: string[] = Array.isArray(body.enrollmentIds) ? body.enrollmentIds : [];
  if (enrollmentIds.length === 0) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }
  const feeTierId = body.feeTierId ? String(body.feeTierId) : null;
  const count = await batchSetFeeTier(enrollmentIds, feeTierId);
  return NextResponse.json({ count });
}
