import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { decideMakeupRequest } from '@/lib/services/makeupRequestService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { decision } = await req.json();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  const updated = await decideMakeupRequest(params.id, decision);
  return NextResponse.json(updated);
}
