import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Falls back to Supabase's auto-injected variable when DATABASE_URL
  // isn't set directly (e.g. a fresh Vercel + Supabase integration).
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
  // Supabase's pooler presents a cert chain that Node's default trust
  // store doesn't have; disable strict verification so the (still
  // encrypted) TLS handshake completes. Local Postgres has no TLS at
  // all, so only apply this for non-local hosts.
  const isLocal = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);
  const ssl = isLocal ? undefined : { rejectUnauthorized: false };
  const adapter = new PrismaPg({ connectionString, ssl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
