import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { assignSubstituteTeacher } from '@/lib/services/substituteRequestService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { substituteTeacherId } = await req.json();
  const updated = await assignSubstituteTeacher(params.id, substituteTeacherId);
  return NextResponse.json(updated);
}
