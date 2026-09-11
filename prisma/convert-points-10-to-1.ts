import 'dotenv/config';
import { PrismaClient, PointBucket } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 一次性上線腳本（可重複執行，冪等）：
// 點數制度改版——舊點數 10 點換新點數 1 點（無條件進位，持點者至少保留 1 點）。
// 兩桶（一般 REGULAR／兌換專用 REDEEM_ONLY）都換算；作法是對每位學生每桶
// 插入一筆 ADMIN_ADJUST 調整流水，歷史紀錄全數保留。
// 已換算過（同桶已有本腳本 reason 的流水）的學生桶會跳過，重跑不會重複除。
//
// 執行：npx tsx prisma/convert-points-10-to-1.ts          ← 只試算列表，不寫入
//       npx tsx prisma/convert-points-10-to-1.ts --apply  ← 實際寫入
// （DATABASE_URL 指向目標資料庫；正式環境帶 Supabase 連線字串執行）

const CONVERT_REASON = '點數制度改版：舊點數10點換新點數1點';

function withNoVerifySsl(connectionString: string) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return connectionString;
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const adapter = new PrismaPg({ connectionString: withNoVerifySsl(raw) });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes('--apply');

async function main() {
  const students = await prisma.student.findMany({
    select: { id: true, user: { select: { name: true } } },
  });

  const adjustments: { studentId: string; name: string; bucket: PointBucket; before: number; after: number }[] = [];
  for (const student of students) {
    for (const bucket of ['REGULAR', 'REDEEM_ONLY'] as const) {
      const agg = await prisma.pointTransaction.aggregate({
        where: { studentId: student.id, bucket },
        _sum: { amount: true },
      });
      const before = agg._sum.amount ?? 0;
      if (before <= 0) continue;

      const alreadyConverted = await prisma.pointTransaction.findFirst({
        where: { studentId: student.id, bucket, reason: CONVERT_REASON },
        select: { id: true },
      });
      if (alreadyConverted) {
        console.log(`跳過（已換算過）：${student.user.name} ${bucket}`);
        continue;
      }

      const after = Math.ceil(before / 10);
      if (after === before) continue;
      adjustments.push({ studentId: student.id, name: student.user.name, bucket, before, after });
    }
  }

  console.log(`\n${APPLY ? '將寫入' : '試算（未寫入，加 --apply 才會寫入）'} ${adjustments.length} 筆調整：\n`);
  for (const a of adjustments) {
    console.log(`  ${a.name}\t${a.bucket === 'REGULAR' ? '一般' : '兌換專用'}\t${a.before} → ${a.after}（調整 ${a.after - a.before}）`);
  }
  const sumBefore = adjustments.reduce((s, a) => s + a.before, 0);
  const sumAfter = adjustments.reduce((s, a) => s + a.after, 0);
  console.log(`\n合計：${sumBefore} → ${sumAfter}`);

  if (!APPLY || adjustments.length === 0) return;

  await prisma.pointTransaction.createMany({
    data: adjustments.map((a) => ({
      studentId: a.studentId,
      bucket: a.bucket,
      amount: a.after - a.before,
      kind: 'ADMIN_ADJUST' as const,
      reason: CONVERT_REASON,
    })),
  });
  console.log(`\n已寫入 ${adjustments.length} 筆 ADMIN_ADJUST 調整。`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
