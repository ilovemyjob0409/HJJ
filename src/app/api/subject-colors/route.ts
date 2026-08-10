import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listSubjectColors, setSubjectColor } from '@/lib/services/subjectColorService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await listSubjectColors());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { subject, color } = await req.json();
  if (typeof subject !== 'string' || !subject || typeof color !== 'string' || !color) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  return NextResponse.json(await setSubjectColor(subject, color));
}
