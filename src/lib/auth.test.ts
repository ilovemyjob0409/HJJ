import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { authOptions } from './auth';
import { createStudent } from './services/studentService';
import { setSiblings, createSwitchToken } from './services/familyService';

// authOptions.providers[0] 是 CredentialsProvider(options) 回傳的設定物件。
// next-auth（4.24.x）的 provider 工廠在頂層放的是一個永遠回傳 null 的 authorize
// 樁函式，我們傳入的原始 options（含真正的 authorize）被原封不動保留在
// `.options` 底下，所以要透過 `.options.authorize` 才能拿到真正要測試的函式，
// 不用跑完整 NextAuth 請求流程。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authorize = (authOptions.providers[0] as any).options.authorize as (
  credentials: Record<string, string> | undefined
) => Promise<{ id: string; name: string; email: string; role: string } | null>;

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

describe('authorize()', () => {
  it('logs in with a valid switch token and consumes it', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    const token = await createSwitchToken(await userIdOf(a.id), b.id);

    const user = await authorize({ switchToken: token });
    expect(user?.name).toBe('B');

    expect(await authorize({ switchToken: token })).toBeNull();
  });

  it('rejects an expired switch token', async () => {
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });
    await prisma.familySwitchToken.create({
      data: { token: 'expired-token', targetUserId: await userIdOf(b.id), expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await authorize({ switchToken: 'expired-token' })).toBeNull();
  });

  it('still logs in with the existing email/password path when no switch token is given', async () => {
    await createStudent({ name: 'C', email: 'c@x.com', password: 'secret123' });
    const user = await authorize({ email: 'c@x.com', password: 'secret123' });
    expect(user?.name).toBe('C');
  });

  it('rejects a wrong password on the existing email/password path', async () => {
    await createStudent({ name: 'D', email: 'd@x.com', password: 'secret123' });
    expect(await authorize({ email: 'd@x.com', password: 'wrong' })).toBeNull();
  });
});
