import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { enrollStudent, unenrollStudent, addEnrollmentSessions } from '@/lib/services/classService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId } = await req.json();
  const enrollment = await enrollStudent(params.id, studentId);
  return NextResponse.json(enrollment, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, addSessions, notRegisteredDates } = await req.json();
  try {
    const updated = await addEnrollmentSessions(params.id, studentId, addSessions, {
      notRegisteredDates: Array.isArray(notRegisteredDates) ? notRegisteredDates.map((d: string) => new Date(d)) : undefined,
      markedById: session.user.id,
    });
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId } = await req.json();
  await unenrollStudent(params.id, studentId);
  return NextResponse.json({ success: true });
}
