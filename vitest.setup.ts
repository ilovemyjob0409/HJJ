process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/tutoring_makeup_system_test';

import { beforeEach } from 'vitest';

beforeEach(async () => {
  const { resetDb } = await import('@/lib/testUtils/resetDb');
  await resetDb();
});
