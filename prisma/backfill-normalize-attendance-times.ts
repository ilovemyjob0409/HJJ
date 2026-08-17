import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeTimeInput } from '../src/lib/timeFormat';

// 一次性上線腳本（可重複執行，冪等）：
// 補零既有的簽到／簽退時間字串（例如 "9:30" -> "09:30"）。
// 未補零的時間字串以字串排序時會被排到不合理的位置（如 "9:30" 排在 "10:00" 之後）。
// 執行：npx tsx prisma/backfill-normalize-attendance-times.ts
// （DATABASE_URL 指向目標資料庫；正式環境帶 Supabase 連線字串執行）

function withNoVerifySsl(connectionString: string) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return connectionString;
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const adapter = new PrismaPg({ connectionString: withNoVerifySsl(raw) });
const prisma = new PrismaClient({ adapter });

const MODELS = [
  'classAttendance',
  'oneOnOneAttendance',
  'goHallAttendance',
  'activityAttendance',
  'tutoringAttendance',
] as const;

const H_MM_PATTERN = /^\d{2}:\d{2}$/;

async function backfillModel(modelName: (typeof MODELS)[number]) {
  const model = prisma[modelName] as {
    findMany: (args: unknown) => Promise<{ id: string; checkInTime: string | null; checkOutTime: string | null }[]>;
    update: (args: unknown) => Promise<unknown>;
  };
  const rows = await model.findMany({
    where: {
      OR: [
        { checkInTime: { not: null } },
        { checkOutTime: { not: null } },
      ],
    },
    select: { id: true, checkInTime: true, checkOutTime: true },
  });

  let fixed = 0;
  for (const row of rows) {
    const checkInTime = row.checkInTime && !H_MM_PATTERN.test(row.checkInTime) ? normalizeTimeInput(row.checkInTime) : row.checkInTime;
    const checkOutTime = row.checkOutTime && !H_MM_PATTERN.test(row.checkOutTime) ? normalizeTimeInput(row.checkOutTime) : row.checkOutTime;
    if (checkInTime === row.checkInTime && checkOutTime === row.checkOutTime) continue;
    await model.update({ where: { id: row.id }, data: { checkInTime, checkOutTime } });
    fixed++;
  }
  console.log(`${modelName}: 檢查 ${rows.length} 筆，補零 ${fixed} 筆`);
}

async function main() {
  for (const modelName of MODELS) {
    await backfillModel(modelName);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
