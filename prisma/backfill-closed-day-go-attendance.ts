import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 一次性上線腳本（冪等）：把所有停課日（ClosedDay：國定假日＋自訂休假）當天的
// 圍棋班級點名改成「未報名」（NOT_REGISTERED，不扣堂）。個別輔導不處理。
// 預設只預覽；加 --apply 才真的寫入。
// 執行：DATABASE_URL=... npx tsx prisma/backfill-closed-day-go-attendance.ts [--apply]

function withNoVerifySsl(connectionString: string) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return connectionString;
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: withNoVerifySsl(raw) }) });

async function main() {
  const apply = process.argv.includes('--apply');
  const closed = await prisma.closedDay.findMany({ select: { date: true } });
  const where = {
    date: { in: closed.map((c) => c.date) },
    status: { not: 'NOT_REGISTERED' as const },
    class: { subject: '圍棋' },
  };
  const rows = await prisma.classAttendance.findMany({
    where,
    select: { id: true, date: true, status: true, studentId: true, class: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });
  console.log(`停課日 ${closed.length} 天；符合的圍棋點名 ${rows.length} 筆`);
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.date.toISOString().slice(0, 10)} ${r.class.name} ${r.status}`;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  byKey.forEach((n, k) => console.log(`  ${k}: ${n}`));
  if (!apply) return console.log('（預覽模式，未寫入；加 --apply 執行）');
  const res = await prisma.classAttendance.updateMany({ where, data: { status: 'NOT_REGISTERED' } });
  console.log(`已更新 ${res.count} 筆`);
}

main().finally(() => prisma.$disconnect());
