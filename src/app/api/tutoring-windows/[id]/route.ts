import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateWindow, deleteWindow } from '@/lib/services/tutoringProgramService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  try {
    const window = await updateWindow(params.id, body);
    return NextResponse.json(window);
  } catch (err) {
    if (err instanceof Error && err.message === 'WINDOW_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteWindow(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'WINDOW_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
