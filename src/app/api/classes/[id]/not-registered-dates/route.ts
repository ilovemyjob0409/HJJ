import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listNotRegisteredDates, setNotRegisteredDates } from '@/lib/services/classService';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const studentId = req.nextUrl.searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'Missing studentId' }, { status: 400 });
  try {
    const dates = await listNotRegisteredDates(params.id, studentId);
    return NextResponse.json({ dates: dates.map((d) => d.toISOString().slice(0, 10)) });
  } catch {
    return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.studentId || !Array.isArray(body.dates)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  try {
    await setNotRegisteredDates(
      params.id,
      body.studentId,
      body.dates.map((d: string) => new Date(d)),
      session.user.id
    );
    const dates = await listNotRegisteredDates(params.id, body.studentId);
    return NextResponse.json({ dates: dates.map((d) => d.toISOString().slice(0, 10)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'INVALID_DATE') return NextResponse.json({ error: message }, { status: 422 });
    return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
  }
}
