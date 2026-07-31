import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 一次性上線腳本（可重複執行，冪等）：
// 1. 為每筆尚無期紀錄的報名補建第一期（sessions = totalSessions ?? 0）
//    —— 上線起所有圍棋學生的一對一補課額度重新起算。
// 2. 補課須知（MakeupNoticeItem）為空時寫入預設內容。
// 執行：npx tsx prisma/backfill-periods-and-notices.ts
// （DATABASE_URL 指向目標資料庫；正式環境帶 Supabase 連線字串執行）

// `sslmode` in the connection string overrides any separate `ssl` option
// passed alongside it (see src/lib/db.ts), so the no-verify override has
// to be baked into the string itself for Supabase's pooler to connect.
function withNoVerifySsl(connectionString: string) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return connectionString;
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const adapter = new PrismaPg({ connectionString: withNoVerifySsl(raw) });
const prisma = new PrismaClient({ adapter });

const DEFAULT_NOTICES = [
  '圍棋班：插班補課不限次數；每期課程可申請一次一對一補課。',
  '英文、數學等其他科目：僅提供插班補課，不限次數。',
  '若家長無法配合插班補課、且該期一對一補課已使用，該期請假未補課之費用將於下一期學費中扣除。',
  '補課申請若被行政人員拒絕，不會計入一對一額度，仍可再次申請。',
];

async function main() {
  const missing = await prisma.classEnrollment.findMany({
    where: { periods: { none: {} } },
    select: { id: true, totalSessions: true },
  });
  for (const e of missing) {
    await prisma.enrollmentPeriod.create({ data: { enrollmentId: e.id, sessions: e.totalSessions ?? 0 } });
  }
  console.log(`已為 ${missing.length} 筆報名補建期紀錄`);

  const noticeCount = await prisma.makeupNoticeItem.count();
  if (noticeCount === 0) {
    await prisma.makeupNoticeItem.createMany({
      data: DEFAULT_NOTICES.map((content, sortOrder) => ({ content, sortOrder })),
    });
    console.log(`已寫入 ${DEFAULT_NOTICES.length} 條預設補課須知`);
  } else {
    console.log(`補課須知已有 ${noticeCount} 筆資料，略過預設寫入`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
