import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteWindowClosure } from '@/lib/services/tutoringProgramService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteWindowClosure(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'CLOSURE_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
