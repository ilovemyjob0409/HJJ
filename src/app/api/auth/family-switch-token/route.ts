import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createSwitchToken } from '@/lib/services/familyService';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { targetStudentId } = await req.json();
  if (!targetStudentId) {
    return NextResponse.json({ error: 'targetStudentId required' }, { status: 400 });
  }
  try {
    const switchToken = await createSwitchToken(session.user.id, targetStudentId);
    return NextResponse.json({ switchToken });
  } catch (err) {
    if (err instanceof Error && (err.message === 'NOT_IN_FAMILY_GROUP' || err.message === 'NOT_A_SIBLING')) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
