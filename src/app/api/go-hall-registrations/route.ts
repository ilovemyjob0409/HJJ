import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { registerForSession, adminRegisterForSession, listRegistrationsForStudent } from '@/lib/services/goHallService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  return NextResponse.json(await listRegistrationsForStudent(student.id));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'STUDENT' && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { sessionId, studentId } = await req.json();

  // 行政代報名：body 指定 studentId，可超額但不能報過去場次。
  if (session.user.role === 'ADMIN') {
    if (!studentId) {
      return NextResponse.json({ error: 'studentId required' }, { status: 400 });
    }
    try {
      const registration = await adminRegisterForSession(sessionId, studentId);
      return NextResponse.json(registration, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: message === 'SESSION_EXPIRED' ? 400 : 409 });
    }
  }

  // 學生自報：忽略 body 的 studentId，永遠報自己。
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  try {
    const registration = await registerForSession(sessionId, student.id);
    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
