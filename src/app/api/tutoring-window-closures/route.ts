import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addWindowClosure } from '@/lib/services/tutoringProgramService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { windowId, date } = await req.json();
  try {
    const closure = await addWindowClosure(windowId, new Date(date));
    return NextResponse.json(closure, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'CLOSURE_ALREADY_EXISTS') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.message === 'WINDOW_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'INVALID_WEEKDAY') {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
