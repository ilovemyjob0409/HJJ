import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { findUserByEmailInsensitive } from './userService';

describe('findUserByEmailInsensitive', () => {
  it('finds a lowercase-stored account when the input differs in case and spacing', async () => {
    await prisma.user.create({
      data: { email: 'hua@example.com', password: 'x', name: '小華', role: 'STUDENT' },
    });

    const user = await findUserByEmailInsensitive('  HUA@Example.com ');
    expect(user?.email).toBe('hua@example.com');
  });

  it('finds a legacy uppercase-stored account from lowercase input', async () => {
    await prisma.user.create({
      data: { email: 'TW_0911119757', password: 'x', name: '黃敬允', role: 'STUDENT' },
    });

    const user = await findUserByEmailInsensitive('tw_0911119757');
    expect(user?.email).toBe('TW_0911119757');
  });

  it('returns null when no account matches', async () => {
    expect(await findUserByEmailInsensitive('nobody@example.com')).toBeNull();
  });
});
