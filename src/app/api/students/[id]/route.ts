import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { updateStudent } from '@/lib/services/studentService';
import { setStudentEnrollments } from '@/lib/services/classService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { classIds, ...profileInput } = await req.json();
  try {
    const updated = await updateStudent(params.id, profileInput);
    if (Array.isArray(classIds)) {
      await setStudentEnrollments(params.id, classIds);
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
