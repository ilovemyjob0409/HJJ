import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setSiblings } from '@/lib/services/familyService';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { siblingIds } = await req.json();
  if (!Array.isArray(siblingIds)) {
    return NextResponse.json({ error: 'siblingIds must be an array' }, { status: 400 });
  }
  try {
    await setSiblings(params.id, siblingIds);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'SIBLING_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
