import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createStudent, listStudents } from '@/lib/services/studentService';
import { setStudentEnrollments } from '@/lib/services/classService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listStudents());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { classId, ...input } = await req.json();
  const student = await createStudent(input);
  if (classId) {
    await setStudentEnrollments(student.id, [classId]);
  }
  return NextResponse.json(student, { status: 201 });
}
