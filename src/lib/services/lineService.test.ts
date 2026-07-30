import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import {
  generateBindCode,
  unbindStudent,
  verifyWebhookSignature,
  handleIncomingMessage,
  pushLineMessage,
  replyLineMessage,
} from './lineService';

// This suite has no final/afterAll cleanup anywhere, so whichever file runs
// last in this file leaves its rows sitting in the shared test database.
// A narrow "just my own tables" sweep isn't safe against that — it must
// clear every table another file's leftover Teacher/Class/etc. could still
// reference, in FK-safe order, matching the defensive full-sweep convention
// every other service test file in this suite already follows.
beforeEach(async () => {
  await prisma.classAttendance.deleteMany();
  await prisma.oneOnOneAttendance.deleteMany();
  await prisma.goHallAttendance.deleteMany();
  await prisma.activityAttendance.deleteMany();
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityImage.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

async function createTestStudent(overrides: { lineUserId?: string | null; lineBindCode?: string | null } = {}) {
  const user = await prisma.user.create({
    data: { name: '測試學生', email: 'line-test@example.com', password: 'x', role: 'STUDENT' },
  });
  return prisma.student.create({ data: { userId: user.id, ...overrides } });
}

describe('generateBindCode', () => {
  it('stores an 8-character bind code on the student and returns a matching add-friend URL', async () => {
    const student = await createTestStudent();
    process.env.LINE_OA_BASIC_ID = '@testoa';

    const { code, addFriendUrl } = await generateBindCode(student.id);

    expect(code).toHaveLength(8);
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineBindCode).toBe(code);
    expect(addFriendUrl).toBe(`https://line.me/R/oaMessage/@testoa/?${code}`);
  });

  it('overwrites a previous unused bind code', async () => {
    const student = await createTestStudent({ lineBindCode: 'OLDCODE1' });

    const { code } = await generateBindCode(student.id);

    expect(code).not.toBe('OLDCODE1');
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineBindCode).toBe(code);
  });
});

describe('unbindStudent', () => {
  it('clears lineUserId', async () => {
    const student = await createTestStudent({ lineUserId: 'Uabc123' });

    await unbindStudent(student.id);

    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineUserId).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  afterEach(() => {
    delete process.env.LINE_CHANNEL_SECRET;
  });

  it('accepts a signature computed with the configured channel secret', () => {
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    const body = '{"events":[]}';
    const signature = crypto.createHmac('sha256', 'test-secret').update(body).digest('base64');

    expect(verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    process.env.LINE_CHANNEL_SECRET = 'test-secret';

    expect(verifyWebhookSignature('{"events":[]}', 'not-a-real-signature')).toBe(false);
  });
});

describe('handleIncomingMessage', () => {
  it('binds the LINE userId to the matching student and clears the bind code', async () => {
    const student = await createTestStudent({ lineBindCode: 'ABCD1234' });

    const { replyText } = await handleIncomingMessage('Uparent123', 'ABCD1234');

    expect(replyText).toContain('綁定成功');
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineUserId).toBe('Uparent123');
    expect(updated.lineBindCode).toBeNull();
  });

  it('trims whitespace before matching the bind code', async () => {
    await createTestStudent({ lineBindCode: 'ABCD1234' });

    const { replyText } = await handleIncomingMessage('Uparent123', '  ABCD1234  ');

    expect(replyText).toContain('綁定成功');
  });

  it('replies with an error when no student matches the code', async () => {
    const { replyText } = await handleIncomingMessage('Uparent123', 'NOMATCH1');

    expect(replyText).toContain('綁定碼無效');
  });
});

describe('pushLineMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });

  it('posts to the LINE push API with the access token and message', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushLineMessage('Uparent123', 'hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ to: 'Uparent123', messages: [{ type: 'text', text: 'hello' }] }),
      })
    );
  });

  it('does not throw when the fetch call rejects', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(pushLineMessage('Uparent123', 'hello')).resolves.toBeUndefined();
  });

  it('does not call fetch when the access token env var is unset', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await pushLineMessage('Uparent123', 'hello');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('replyLineMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });

  it('posts to the LINE reply API with the reply token and message', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await replyLineMessage('replyToken123', 'hello back');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ replyToken: 'replyToken123', messages: [{ type: 'text', text: 'hello back' }] }),
      })
    );
  });
});
