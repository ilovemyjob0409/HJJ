import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { registerForActivity, listRegistrationsForStudent, adminRegisterStudent } from '@/lib/services/activityService';

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
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // 行政代報名：帶 studentId、不受名額限制（service 層放行超額）
  if (session.user.role === 'ADMIN') {
    try {
      const { activityId, studentId } = await req.json();
      if (typeof activityId !== 'string' || !activityId || typeof studentId !== 'string' || !studentId) {
        return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
      }
      const registration = await adminRegisterStudent(activityId, studentId);
      return NextResponse.json(registration, { status: 201 });
    } catch (err) {
      if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
      const message = err instanceof Error ? err.message : '';
      if (message === 'NOT_FOUND') return NextResponse.json({ error: message }, { status: 404 });
      if (message === 'ALREADY_REGISTERED') return NextResponse.json({ error: message }, { status: 409 });
      console.error('POST /api/activity-registrations (admin) failed', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    }
  }

  if (session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const { activityId } = await req.json();
  try {
    const registration = await registerForActivity(activityId, student.id);
    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
