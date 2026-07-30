import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, handleIncomingMessage, replyLineMessage } from '@/lib/services/lineService';

interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(rawBody) as { events: LineWebhookEvent[] };

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text' || !event.source?.userId || !event.replyToken) {
      continue;
    }
    try {
      const { replyText } = await handleIncomingMessage(event.source.userId, event.message.text ?? '');
      if (replyText) {
        await replyLineMessage(event.replyToken, replyText);
      }
    } catch (err) {
      console.error('Failed to handle LINE webhook event', err);
    }
  }

  return NextResponse.json({ success: true });
}
