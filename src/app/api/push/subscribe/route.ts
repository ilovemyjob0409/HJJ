import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { saveSubscription, removeSubscription } from '@/lib/services/pushService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  await saveSubscription(
    session.user.id,
    { endpoint, p256dh, auth },
    typeof body.userAgent === 'string' ? body.userAgent : undefined
  );
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (typeof body?.endpoint !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  await removeSubscription(session.user.id, body.endpoint);
  return NextResponse.json({ success: true });
}
