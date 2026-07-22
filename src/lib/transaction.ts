import { Prisma } from '@prisma/client';
import { isDriverAdapterError } from '@prisma/driver-adapter-utils';

// Postgres's default READ COMMITTED isolation does not prevent
// check-then-act races (two concurrent transactions can both pass a
// capacity/quota check before either commits). Wrap any $transaction that
// needs true isolation in Serializable mode and retry through this
// helper: Postgres aborts one of the two transactions with a
// serialization failure, which surfaces as a DriverAdapterError with
// `.cause.kind === 'TransactionWriteConflict'` under the `pg` driver
// adapter this project uses (not as a classic PrismaClientKnownRequestError
// P2034 — that mapping only applies to Prisma's built-in query engine;
// confirmed empirically in makeupRequestService, not by assumption).
export async function runSerializableWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isSerializationFailure =
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') ||
        (isDriverAdapterError(err) && err.cause.kind === 'TransactionWriteConflict');
      if (!isSerializationFailure || attempt === attempts) throw err;
    }
  }
  throw new Error('unreachable');
}
