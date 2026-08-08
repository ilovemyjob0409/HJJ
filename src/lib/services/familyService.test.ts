import { describe, it, expect } from 'vitest';
import { createStudent } from './studentService';
import { listSiblings, setSiblings, createSwitchToken, redeemSwitchToken } from './familyService';

describe('listSiblings', () => {
  it('returns an empty array when the student has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    expect(await listSiblings(await userIdOf(a.id))).toEqual([]);
  });
});

describe('setSiblings', () => {
  it('groups two students together and lists each other as siblings', async () => {
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });

    await setSiblings(a.id, [b.id]);

    expect(await listSiblings(await userIdOf(a.id))).toEqual([{ id: b.id, name: 'B' }]);
    expect(await listSiblings(await userIdOf(b.id))).toEqual([{ id: a.id, name: 'A' }]);
  });

  it('merges a third student into an existing pair instead of creating a new group', async () => {
    const a = await createStudent({ name: 'A', email: 'a3@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b3@x.com', password: 'pw' });
    const c = await createStudent({ name: 'C', email: 'c3@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    await setSiblings(c.id, [a.id]);

    const siblingsOfB = await listSiblings(await userIdOf(b.id));
    expect(siblingsOfB.map((s) => s.name).sort()).toEqual(['A', 'C']);
  });

  it('clears the family group when siblingIds is empty', async () => {
    const a = await createStudent({ name: 'A', email: 'a4@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b4@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    await setSiblings(a.id, []);

    expect(await listSiblings(await userIdOf(a.id))).toEqual([]);
    // b 不受影響，仍然沒有手足（因為只剩它自己在原本的群組裡）
    expect(await listSiblings(await userIdOf(b.id))).toEqual([]);
  });

  it('rejects a nonexistent sibling id with SIBLING_NOT_FOUND', async () => {
    const a = await createStudent({ name: 'A', email: 'a5@x.com', password: 'pw' });
    await expect(setSiblings(a.id, ['nonexistent-id'])).rejects.toThrow('SIBLING_NOT_FOUND');
  });

  it('unlinks a sibling that is left unchecked', async () => {
    const a = await createStudent({ name: 'A', email: 'unlink-a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'unlink-b@x.com', password: 'pw' });
    const c = await createStudent({ name: 'C', email: 'unlink-c@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id, c.id]);

    await setSiblings(a.id, [b.id]); // uncheck c

    const siblingsOfA = await listSiblings(await userIdOf(a.id));
    expect(siblingsOfA.map((s) => s.name)).toEqual(['B']);
    const siblingsOfC = await listSiblings(await userIdOf(c.id));
    expect(siblingsOfC).toEqual([]);
  });

  it('pulls a selected sibling\'s own group members along, not just the individual', async () => {
    const a = await createStudent({ name: 'A', email: 'merge-a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'merge-b@x.com', password: 'pw' });
    const c = await createStudent({ name: 'C', email: 'merge-c@x.com', password: 'pw' });
    const d = await createStudent({ name: 'D', email: 'merge-d@x.com', password: 'pw' });
    const e = await createStudent({ name: 'E', email: 'merge-e@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]); // group 1: a,b
    await setSiblings(c.id, [d.id]); // group 2: c,d

    await setSiblings(e.id, [a.id, c.id]); // e picks one member from each group

    const siblingsOfB = await listSiblings(await userIdOf(b.id));
    expect(siblingsOfB.map((s) => s.name).sort()).toEqual(['A', 'C', 'D', 'E']);
  });
});

describe('createSwitchToken', () => {
  it('issues a token when the caller and target share a family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a6@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b6@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    const token = await createSwitchToken(await userIdOf(a.id), b.id);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('rejects when the caller has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a7@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b7@x.com', password: 'pw' });
    await expect(createSwitchToken(await userIdOf(a.id), b.id)).rejects.toThrow('NOT_IN_FAMILY_GROUP');
  });

  it('rejects when the target is not in the same family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a8@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b8@x.com', password: 'pw' });
    const outsider = await createStudent({ name: 'X', email: 'x8@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    await expect(createSwitchToken(await userIdOf(a.id), outsider.id)).rejects.toThrow('NOT_A_SIBLING');
  });

  it('rejects a target that belongs to a different family group', async () => {
    const a = await createStudent({ name: 'A', email: 'xgroup-a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'xgroup-b@x.com', password: 'pw' });
    const x = await createStudent({ name: 'X', email: 'xgroup-x@x.com', password: 'pw' });
    const y = await createStudent({ name: 'Y', email: 'xgroup-y@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    await setSiblings(x.id, [y.id]);

    await expect(createSwitchToken(await userIdOf(a.id), x.id)).rejects.toThrow('NOT_A_SIBLING');
  });
});

describe('redeemSwitchToken', () => {
  it('returns the target user once, then rejects on second use', async () => {
    const a = await createStudent({ name: 'A', email: 'a9@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b9@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    const token = await createSwitchToken(await userIdOf(a.id), b.id);

    const user = await redeemSwitchToken(token);
    expect(user?.name).toBe('B');
    expect(Object.keys(user ?? {}).sort()).toEqual(['email', 'id', 'name', 'role']);

    expect(await redeemSwitchToken(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { prisma } = await import('@/lib/db');
    const b = await createStudent({ name: 'B', email: 'b10@x.com', password: 'pw' });
    await prisma.familySwitchToken.create({
      data: { token: 'expired-token', targetUserId: await userIdOf(b.id), expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await redeemSwitchToken('expired-token')).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await redeemSwitchToken('never-issued')).toBeNull();
  });
});

// createStudent() 的回傳型別（STUDENT_SELECT）不含 userId，測試需要直接查表拿。
async function userIdOf(studentId: string): Promise<string> {
  const { prisma } = await import('@/lib/db');
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}
