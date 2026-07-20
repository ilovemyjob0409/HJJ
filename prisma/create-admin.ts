import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
const isLocal = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);
const ssl = isLocal ? undefined : { rejectUnauthorized: false };
const adapter = new PrismaPg({ connectionString, ssl });
const prisma = new PrismaClient({ adapter });

const ADMIN_EMAIL = 'hjjdaya@gmail.com';
const ADMIN_PASSWORD = '12345678';
const ADMIN_NAME = '行政人員';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    console.log(`Admin already exists, skipping: ${ADMIN_EMAIL}`);
    return;
  }

  const password = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: { email: ADMIN_EMAIL, password, name: ADMIN_NAME, role: 'ADMIN' },
  });

  console.log('Admin created:', admin.email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
