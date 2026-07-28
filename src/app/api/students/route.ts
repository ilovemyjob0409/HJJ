import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
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
  const { enrollments, ...input } = await req.json();
  try {
    const student = await createStudent(input);
    if (Array.isArray(enrollments) && enrollments.length > 0) {
      await setStudentEnrollments(student.id, enrollments);
    }
    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]) : [];
      const error = target.includes('studentNumber') ? 'STUDENT_NUMBER_TAKEN' : 'EMAIL_TAKEN';
      return NextResponse.json({ error }, { status: 409 });
    }
    throw err;
  }
}
