import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest, { params }: { params: { windowId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUnique({ where: { id: params.windowId } });
    if (!window) return NextResponse.json({ error: 'WINDOW_NOT_FOUND' }, { status: 404 });
    if (window.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await getTutoringRoster(params.windowId, new Date(dateParam)));
}

export async function POST(req: NextRequest, { params }: { params: { windowId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUnique({ where: { id: params.windowId } });
    if (!window) return NextResponse.json({ error: 'WINDOW_NOT_FOUND' }, { status: 404 });
    if (window.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.records) || body.records.length === 0) {
    return NextResponse.json({ error: 'records required' }, { status: 400 });
  }
  await saveTutoringAttendance(session.user.id, body.records);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { windowId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUnique({ where: { id: params.windowId } });
    if (!window) return NextResponse.json({ error: 'WINDOW_NOT_FOUND' }, { status: 404 });
    if (window.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.clear)) {
    return NextResponse.json({ error: 'clear required' }, { status: 400 });
  }
  await clearTutoringAttendance(body.clear);
  return NextResponse.json({ success: true });
}
