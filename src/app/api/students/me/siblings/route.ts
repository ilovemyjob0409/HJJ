import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listSiblings } from '@/lib/services/familyService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const siblings = await listSiblings(session.user.id);
  return NextResponse.json({ self: { name: session.user.name }, siblings });
}
