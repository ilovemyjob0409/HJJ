import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ANNOUNCEMENT_MAX_LENGTH, isAnnouncementAudience } from '@/lib/activityAnnouncement';
import { listActivityAnnouncements, sendActivityAnnouncement } from '@/lib/services/activityNotifyService';

// 對象選「全體學生」時要逐筆推播，給足背景推播時間（比照 admin/billing/notify）
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listActivityAnnouncements(params.id));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const audience = body.audience;
  if (!isAnnouncementAudience(audience)) {
    return NextResponse.json({ error: 'INVALID_AUDIENCE' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'MESSAGE_REQUIRED' }, { status: 400 });
  if (message.length > ANNOUNCEMENT_MAX_LENGTH) {
    return NextResponse.json({ error: 'MESSAGE_TOO_LONG' }, { status: 400 });
  }
  try {
    const result = await sendActivityAnnouncement({
      activityId: params.id,
      senderId: session.user.id,
      audience,
      includeTeachers: body.includeTeachers === true,
      message,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'NOT_FOUND') return NextResponse.json({ error: code }, { status: 404 });
    if (code === 'NO_RECIPIENTS') return NextResponse.json({ error: code }, { status: 409 });
    console.error('POST /api/activities/[id]/announcements failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
