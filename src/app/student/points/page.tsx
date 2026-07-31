import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPointBalances, listPointHistory } from '@/lib/services/pointService';
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

  const [balances, history] = await Promise.all([getPointBalances(student.id), listPointHistory(student.id)]);
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
