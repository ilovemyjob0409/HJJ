import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPointBalances, listPointHistory } from '@/lib/services/pointService';
import { listRewardItems } from '@/lib/services/rewardItemService';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  TEACHER_AWARD: '老師給點',
  LOTTERY_COST: '抽獎',
  LOTTERY_WIN: '抽獎獲得',
  REDEMPTION: '兌換',
  ADMIN_ADJUST: '調整',
};

interface HistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string;
  createdAt: Date;
  teacher: { user: { name: string } } | null;
}

export default async function StudentPointsPage() {
  const session = await getServerSession(authOptions);
  const student = session ? await prisma.student.findUnique({ where: { userId: session.user.id } }) : null;

  if (!student) {
    return (
      <>
        <h1 className="mb-4 text-xl font-bold text-ink">集點卡</h1>
        <Card>
          <p className="text-sm text-inkMuted">找不到學生資料</p>
        </Card>
      </>
    );
  }

  const [balances, history, rewards] = await Promise.all([
    getPointBalances(student.id),
    listPointHistory(student.id),
    listRewardItems(),
  ]);
  const total = balances.regular + balances.redeemOnly;

  const historyColumns: Column<HistoryRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.createdAt) },
    { header: '類型', render: (r) => KIND_LABELS[r.kind] ?? r.kind },
    { header: '說明', render: (r) => r.reason },
    {
      header: '點數',
      render: (r) => (
        <span className={r.amount > 0 ? 'font-semibold text-approved' : 'font-semibold text-rejected'}>
          {r.amount > 0 ? `+${r.amount}` : r.amount}
        </span>
      ),
    },
    { header: '給點老師', render: (r) => r.teacher?.user.name ?? '-' },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">集點卡</h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-inkMuted">一般點數</p>
          <p className="mt-1 text-2xl font-bold text-ink">{balances.regular}</p>
        </Card>
        <Card>
          <p className="text-sm text-inkMuted">兌換專用點數</p>
          <p className="mt-1 text-2xl font-bold text-ink">{balances.redeemOnly}</p>
          <p className="mt-1 text-xs text-inkMuted">抽獎抽中的點數，只能兌換獎品</p>
        </Card>
        <Card>
          <p className="text-sm text-inkMuted">合計</p>
          <p className="mt-1 text-2xl font-bold text-brandDark">{total}</p>
        </Card>
      </div>

      {rewards.length > 0 && (
        <>
          <h2 className="mb-2 font-bold text-ink">獎品目錄</h2>
          <Card className="mb-6">
            <ul className="divide-y divide-borderSubtle">
              {rewards.map((r) => {
                const affordable = total >= r.pointsCost;
                return (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{r.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-inkMuted">{r.pointsCost} 點</span>
                      {affordable && (
                        <span className="rounded-full bg-approvedBg px-2 py-0.5 text-xs font-semibold text-approved">可兌換</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-inkMuted">想兌換獎品請至櫃檯，由行政人員為您扣點。</p>
          </Card>
        </>
      )}

      <h2 className="mb-2 font-bold text-ink">點數紀錄</h2>
      <Card>
        {history.length === 0 ? (
          <p className="text-sm text-inkMuted">尚無點數紀錄</p>
        ) : (
          <DataTable columns={historyColumns} rows={history} keyField={(r) => r.id} />
        )}
      </Card>
    </>
  );
}
