import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createClass, listClasses, listClassesForBooking } from '@/lib/services/classService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Students and teachers only use this to populate a class picker (see
  // src/app/student/leave-request/page.tsx and
  // src/app/teacher/leave-request/page.tsx), so they get the narrow,
  // phone/email-free projection. Admins keep the full management view.
  const classes = session.user.role === 'ADMIN' ? await listClasses() : await listClassesForBooking();
  return NextResponse.json(classes);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const cls = await createClass(body);
  return NextResponse.json(cls, { status: 201 });
}
