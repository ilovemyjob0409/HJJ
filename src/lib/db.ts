import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Supabase's pooler presents a cert chain that Node's default trust store
// doesn't have. `pg` parses `sslmode` out of the connection string itself
// and that overrides any `ssl` object passed alongside it (see
// pg/lib/connection-parameters.js), so the override has to live in the
// string, not as a separate option. Local Postgres has no TLS at all, so
// this only applies to non-local hosts.
function withNoVerifySsl(connectionString: string) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return connectionString;
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

function createPrismaClient() {
  // Falls back to Supabase's auto-injected variable when DATABASE_URL
  // isn't set directly (e.g. a fresh Vercel + Supabase integration).
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '';
  const connectionString = withNoVerifySsl(raw);
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
