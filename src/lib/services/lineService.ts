import crypto from 'crypto';
import { prisma } from '@/lib/db';

const BIND_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BIND_CODE_LENGTH = 8;

function randomBindCode(): string {
  const bytes = crypto.randomBytes(BIND_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < BIND_CODE_LENGTH; i++) {
    code += BIND_CODE_CHARS[bytes[i] % BIND_CODE_CHARS.length];
  }
  return code;
}

export async function generateBindCode(studentId: string): Promise<{ code: string; addFriendUrl: string }> {
  const code = randomBindCode();
  await prisma.student.update({ where: { id: studentId }, data: { lineBindCode: code } });
  const basicId = process.env.LINE_OA_BASIC_ID ?? '';
  const addFriendUrl = `https://line.me/R/oaMessage/${basicId}/?${encodeURIComponent(code)}`;
  return { code, addFriendUrl };
}

export async function unbindStudent(studentId: string): Promise<void> {
  await prisma.student.update({ where: { id: studentId }, data: { lineUserId: null } });
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? '';
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export async function handleIncomingMessage(lineUserId: string, text: string): Promise<{ replyText: string }> {
  const code = text.trim();
  const student = await prisma.student.findUnique({
    where: { lineBindCode: code },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) {
    return { replyText: '綁定碼無效，請洽行政人員重新產生' };
  }
  await prisma.student.update({ where: { id: student.id }, data: { lineUserId, lineBindCode: null } });
  return { replyText: `綁定成功，之後會通知您 ${student.user.name} 的點名與補課申請結果` };
}

async function callLineApi(url: string, body: unknown): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error(`LINE_CHANNEL_ACCESS_TOKEN not set, skipping call to ${url}`);
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`LINE API call to ${url} failed with status ${res.status}`);
    }
  } catch (err) {
    console.error(`LINE API call to ${url} threw`, err);
  }
}

export async function pushLineMessage(lineUserId: string, text: string): Promise<void> {
  await callLineApi('https://api.line.me/v2/bot/message/push', {
    to: lineUserId,
    messages: [{ type: 'text', text }],
  });
}

export async function replyLineMessage(replyToken: string, text: string): Promise<void> {
  await callLineApi('https://api.line.me/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text }],
  });
}
