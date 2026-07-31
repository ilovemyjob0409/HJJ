'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import PointReasonsManager from './PointReasonsManager';
import RewardItemsManager from './RewardItemsManager';

const DRAW_COST = 20; // 與 pointService.DRAW_COST 一致（顯示用）

const KIND_LABELS: Record<string, string> = {
  TEACHER_AWARD: '老師給點',
  LOTTERY_COST: '抽獎',
  LOTTERY_WIN: '抽獎獲得',
  REDEMPTION: '兌換',
  ADMIN_ADJUST: '調整',
};

interface StudentRow {
  id: string;
  studentNumber: string | null;
  user: { name: string };
}

interface RewardRow {
  id: string;
  name: string;
  pointsCost: number;
}

interface HistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string;
  createdAt: string;
  teacher: { user: { name: string } } | null;
}

interface PointsData {
  balances: { regular: number; redeemOnly: number };
  history: HistoryRow[];
}

export default function AdminPointsPage() {
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState<PointsData | null>(null);
  const [busy, setBusy] = useState(false);

  const [redeemRewardId, setRedeemRewardId] = useState('');
  const [draws, setDraws] = useState('');
  const [wonPoints, setWonPoints] = useState('');
  const [adjustBucket, setAdjustBucket] = useState<'REGULAR' | 'REDEEM_ONLY'>('REGULAR');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  useEffect(() => {
    fetch('/api/students').then((r) => (r.ok ? r.json() : [])).then(setStudents);
    loadRewards();
  }, []);

  function loadRewards() {
    fetch('/api/reward-items').then((r) => (r.ok ? r.json() : [])).then(setRewards);
  }

  async function loadPoints(studentId: string) {
    const res = await fetch(`/api/points?studentId=${studentId}`);
    if (!res.ok) {
      showToast('載入點數失敗，請稍後再試');
      return;
    }
    setData(await res.json());
  }

  useEffect(() => {
    setData(null);
    if (selectedId) loadPoints(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => s.user.name.toLowerCase().includes(q) || (s.studentNumber ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [students, search]);

  const selectedStudent = students.find((s) => s.id === selectedId);
  const total = data ? data.balances.regular + data.balances.redeemOnly : 0;
  const drawsNum = Number(draws);
  const drawCostTotal = Number.isInteger(drawsNum) && drawsNum > 0 ? drawsNum * DRAW_COST : 0;

  async function post(url: string, body: unknown, successMessage: string) {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const resData = await res.json();
        showToast(resData.error === 'INSUFFICIENT_POINTS' ? '點數不足' : `操作失敗：${resData.error}`);
        return false;
      }
      showToast(successMessage);
      loadPoints(selectedId);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    const reward = rewards.find((r) => r.id === redeemRewardId);
    if (!reward) return;
    if (!confirm(`確定為「${selectedStudent?.user.name}」兌換「${reward.name}」（扣 ${reward.pointsCost} 點）嗎？`)) return;
    const ok = await post('/api/points/redeem', { studentId: selectedId, rewardItemId: redeemRewardId }, `已兌換「${reward.name}」`);
    if (ok) setRedeemRewardId('');
  }

  async function handleLottery(e: React.FormEvent) {
    e.preventDefault();
    const ok = await post(
      '/api/points/lottery',
      { studentId: selectedId, draws: Number(draws), wonPoints: Number(wonPoints) },
      '已登記抽獎'
    );
    if (ok) {
      setDraws('');
      setWonPoints('');
    }
  }

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    const ok = await post(
      '/api/points/adjust',
      { studentId: selectedId, bucket: adjustBucket, amount: Number(adjustAmount), reason: adjustReason },
      '已調整點數'
    );
    if (ok) {
      setAdjustAmount('');
      setAdjustReason('');
    }
  }

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
      <h1 className="mb-4 text-xl font-bold text-ink">集點管理</h1>

      <Card className="mb-6 max-w-xl">
        <p className="mb-1 text-sm font-medium text-ink">選擇學生</p>
        <Input placeholder="搜尋姓名或學號…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {filtered.length > 0 && (
          <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelectedId(s.id);
                  setSearch('');
                }}
                className="flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe"
              >
                <span className="text-ink">{s.user.name}</span>
                <span className="text-xs text-inkMuted">{s.studentNumber ?? '-'}</span>
              </button>
            ))}
          </div>
        )}
        {selectedStudent && (
          <p className="mt-3 text-sm text-ink">
            目前操作對象：<span className="font-semibold">{selectedStudent.user.name}</span>
            {data && (
              <span className="ml-2 text-inkMuted">
                一般 {data.balances.regular} 點／兌換專用 {data.balances.redeemOnly} 點／合計 {total} 點
              </span>
            )}
          </p>
        )}
      </Card>

      {selectedStudent && data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <h2 className="mb-2 font-bold text-ink">兌換獎品</h2>
              <form onSubmit={handleRedeem} className="flex flex-col gap-2">
                <Select value={redeemRewardId} onChange={(e) => setRedeemRewardId(e.target.value)} required>
                  <option value="">選擇獎品</option>
                  {rewards.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}（{r.pointsCost} 點）
                    </option>
                  ))}
                </Select>
                <Button type="submit" loading={busy} disabled={!redeemRewardId}>
                  兌換並扣點
                </Button>
              </form>
            </Card>

            <Card>
              <h2 className="mb-2 font-bold text-ink">抽獎登記</h2>
              <form onSubmit={handleLottery} className="flex flex-col gap-2">
                <Input type="number" min={1} placeholder="抽幾次" value={draws} onChange={(e) => setDraws(e.target.value)} required />
                <Input
                  type="number"
                  min={0}
                  placeholder="抽中總點數"
                  value={wonPoints}
                  onChange={(e) => setWonPoints(e.target.value)}
                  required
                />
                <p className="text-xs text-inkMuted">
                  {drawCostTotal > 0 ? `將扣一般點數 ${drawsNum} × ${DRAW_COST} ＝ ${drawCostTotal} 點` : `每抽固定扣 ${DRAW_COST} 點（一般點數）`}
                  ；抽中點數只能用於兌換
                </p>
                <Button type="submit" loading={busy}>
                  送出登記
                </Button>
              </form>
            </Card>

            <Card>
              <h2 className="mb-2 font-bold text-ink">點數調整</h2>
              <form onSubmit={handleAdjust} className="flex flex-col gap-2">
                <Select value={adjustBucket} onChange={(e) => setAdjustBucket(e.target.value as 'REGULAR' | 'REDEEM_ONLY')}>
                  <option value="REGULAR">一般點數</option>
                  <option value="REDEEM_ONLY">兌換專用點數</option>
                </Select>
                <Input
                  type="number"
                  placeholder="±點數（例如 5 或 -3）"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  required
                />
                <Input placeholder="原因（必填）" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} required />
                <Button type="submit" loading={busy}>
                  調整
                </Button>
              </form>
            </Card>
          </div>

          <h2 className="mb-2 font-bold text-ink">點數紀錄</h2>
          <Card className="mb-8">
            {data.history.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無點數紀錄</p>
            ) : (
              <DataTable columns={historyColumns} rows={data.history} keyField={(r) => r.id} />
            )}
          </Card>
        </>
      )}

      <RewardItemsManager onChanged={loadRewards} />
      <PointReasonsManager />
    </>
  );
}
