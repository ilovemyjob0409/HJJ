import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPointBalances, listPointHistory } from '@/lib/services/pointService';
import Card from '@/components/ui/Card';
import PointsHistoryTable from './PointsHistoryTable';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

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
        <PointsHistoryTable rows={history} />
      </Card>
    </>
  );
}
