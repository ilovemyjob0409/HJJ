import { Prisma } from '@prisma/client';

// Prisma's P2002 error shape for "which column collided" has drifted across
// versions: older engines populate `err.meta.target` as a flat string array
// of column (or constraint) names. This project runs Prisma 7's driver-adapter
// client (`@prisma/adapter-pg`), which instead leaves `meta.target` undefined
// and nests the real detail inside `meta.driverAdapterError.cause` — either
// `constraint.fields` (an array, values still carrying the driver's quoting,
// e.g. `"studentNumber"`) or `originalMessage` (the raw Postgres error text,
// which names the constraint, e.g. `Student_studentNumber_key`). Checking only
// the old `target` shape silently never matches on this runtime, so every
// P2002 falls through to the wrong branch. Search all the places the field
// name could plausibly appear rather than assuming one fixed shape.
export function p2002TargetsField(err: Prisma.PrismaClientKnownRequestError, fieldName: string): boolean {
  const meta = (err.meta ?? {}) as Record<string, unknown>;

  const topLevelTarget = meta.target;
  const targetText = Array.isArray(topLevelTarget)
    ? topLevelTarget.map(String).join(' ')
    : typeof topLevelTarget === 'string'
      ? topLevelTarget
      : '';

  const driverAdapterError = meta.driverAdapterError as
    | { cause?: { originalMessage?: unknown; constraint?: { fields?: unknown } } }
    | undefined;
  const constraintFields = driverAdapterError?.cause?.constraint?.fields;
  const constraintFieldsText = Array.isArray(constraintFields) ? constraintFields.map(String).join(' ') : '';
  const originalMessage =
    typeof driverAdapterError?.cause?.originalMessage === 'string' ? driverAdapterError.cause.originalMessage : '';

  return `${targetText} ${constraintFieldsText} ${originalMessage}`.includes(fieldName);
}
