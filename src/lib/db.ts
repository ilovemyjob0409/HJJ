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
  const isLocal = /localhost|127\.0\.0\.1/.test(raw);
  // Production pool sizing and self-healing. `max: 1` was free-tier armor
  // (15-connection session-mode cap), but it turned any single dead
  // connection into a fully bricked instance: after a Supabase restart
  // (e.g. a compute resize) a warm instance's pooled socket points at the
  // old server, a query on it waits on bare TCP for many minutes, and with
  // only one connection and an unbounded acquire wait every request routed
  // to that instance hangs — while the database itself sits idle. On the
  // paid tier (max_connections 90) a real pool is safe; even several warm
  // instances stay far below the server cap.
  // - query_timeout: a query that gets no response (dead socket) errors in
  //   30s and the pool discards that connection, instead of stalling until
  //   TCP retransmission gives up.
  // - connectionTimeoutMillis bounds connect/acquire waits the same way.
  // - keepAlive lets TCP itself notice dead peers sooner.
  // Left at defaults locally: the concurrency-safety tests in
  // makeupRequestService.test.ts depend on two Serializable transactions
  // actually running on separate connections at the same time to trigger
  // (and verify the retry-on) a real TransactionWriteConflict, and local
  // dev has no pooler restarts to defend against.
  const adapter = isLocal
    ? new PrismaPg({ connectionString })
    : new PrismaPg({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 10_000,
        query_timeout: 30_000,
        keepAlive: true,
      });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
