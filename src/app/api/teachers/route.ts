import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createTeacher, listTeachers } from '@/lib/services/teacherService';

export async function GET() {
  const session = await getServerSession(authOptions);
  // Students need this list too, to pick a teacher for a one-on-one makeup
  // request (see src/app/student/makeup-request/page.tsx).
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'STUDENT')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teachers = await listTeachers();
  return NextResponse.json(teachers);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const teacher = await createTeacher(body);
  return NextResponse.json(teacher, { status: 201 });
}
