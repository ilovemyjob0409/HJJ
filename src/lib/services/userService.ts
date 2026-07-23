import { prisma } from '@/lib/db';

// Login lookup: emails are normalized (trim + lowercase) on write since the
// duplicate-account fix, but accounts created before that may be stored with
// arbitrary casing/whitespace — so the lookup itself must be insensitive
// rather than just normalizing the input. Ordered by createdAt so any legacy
// case-only duplicates resolve to the oldest account deterministically.
export function findUserByEmailInsensitive(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });
}
