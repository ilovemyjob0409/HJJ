import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Falls back to Supabase's auto-injected variable when DATABASE_URL
  // isn't set directly (e.g. a fresh Vercel + Supabase integration).
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
