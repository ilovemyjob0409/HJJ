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

const DRAW_COST = 20; // 與 pointService.DRAW_COST 一致（顯示用）

const KIND_LABELS: Record<string, string> = {
  TEACHER_AWARD: '加分',
  LOTTERY_COST: '抽獎',
  LOTTERY_WIN: '抽獎獲得',
  REDEMPTION: '兌換',
  ADMIN_ADJUST: '調整',
};

interface SummaryRow {
  id: string;
  name: string;
  studentNumber: string | null;
  classes: { id: string; name: string }[];
  regular: number;
  redeemOnly: number;
}

interface ReasonRow {
  id: string;
  label: string;
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
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [reasons, setReasons] = useState<ReasonRow[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [batchAmount, setBatchAmount] = useState('1');
  const [batchReasonId, setBatchReasonId] = useState('');

  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState<PointsData | null>(null);
  const [busy, setBusy] = useState(false);

  const [redeemPoints, setRedeemPoints] = useState('');
  const [redeemDescription, setRedeemDescription] = useState('');
  const [draws, setDraws] = useState('');
  const [wonPoints, setWonPoints] = useState('');
  const [adjustBucket, setAdjustBucket] = useState<'REGULAR' | 'REDEEM_ONLY'>('REGULAR');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  async function loadSummaries() {
    try {
      const res = await fetch('/api/points/summary');
      if (res.ok) setSummaries(await res.json());
    } finally {
      setSummariesLoading(false);
    }
  }

  useEffect(() => {
    loadSummaries();
    fetch('/api/point-reasons').then((r) => (r.ok ? r.json() : [])).then(setReasons);
  }, []);

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

  const classOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of summaries) for (const c of s.classes) seen.set(c.id, c.name);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  }, [summaries]);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return summaries.filter((s) => {
      if (classFilter && !s.classes.some((c) => c.id === classFilter)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !(s.studentNumber ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [summaries, classFilter, nameQuery]);

  const checkedIds = filtered.filter((s) => checked[s.id]).map((s) => s.id);
  const selectedStudent = summaries.find((s) => s.id === selectedId);
  const total = data ? data.balances.regular + data.balances.redeemOnly : 0;
  const drawsNum = Number(draws);
  const drawCostTotal = Number.isInteger(drawsNum) && drawsNum > 0 ? drawsNum * DRAW_COST : 0;

  function refreshAfterChange() {
    loadSummaries();
    if (selectedId) loadPoints(selectedId);
  }

  async function handleBatchAward(e: React.FormEvent) {
    e.preventDefault();
    if (checkedIds.length === 0) {
      showToast('請先勾選學生');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/points/award', {
        method: 'POST',
        body: JSON.stringify({ studentIds: checkedIds, amount: Number(batchAmount), reasonId: batchReasonId }),
      });
      if (!res.ok) {
        const resData = await res.json();
        showToast(resData.error === 'INVALID_AMOUNT' ? '點數需為 1–10 的整數' : `操作失敗：${resData.error}`);
        return;
      }
      showToast(`已為 ${checkedIds.length} 位學生各加 ${Number(batchAmount)} 點`);
      setChecked({});
      setBatchAmount('1');
      refreshAfterChange();
    } finally {
      setBusy(false);
    }
  }

  async function post(url: string, body: unknown, successMessage: string) {
    if (!selectedId) return false;
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const resData = await res.json();
        showToast(resData.error === 'INSUFFICIENT_POINTS' ? '點數不足' : `操作失敗：${resData.error}`);
        return false;
      }
      showToast(successMessage);
      refreshAfterChange();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`確定為「${selectedStudent?.name}」兌換「${redeemDescription}」（扣 ${Number(redeemPoints)} 點）嗎？`)) return;
    const ok = await post(
      '/api/points/redeem',
      { studentId: selectedId, points: Number(redeemPoints), description: redeemDescription },
      `已兌換「${redeemDescription}」`
    );
    if (ok) {
      setRedeemPoints('');
      setRedeemDescription('');
    }
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

  const summaryColumns: Column<SummaryRow>[] = [
    {
      header: '選取',
      render: (s) => (
        <input
          type="checkbox"
          checked={!!checked[s.id]}
          onChange={() => setChecked((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      header: '學生',
      render: (s) => (
        <div className="text-left">
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-inkMuted">{s.studentNumber ?? '-'}</div>
        </div>
      ),
    },
    { header: '班級', render: (s) => <span className="text-xs">{s.classes.map((c) => c.name).join('、') || '-'}</span> },
    { header: '一般點數', render: (s) => <span className="font-semibold">{s.regular}</span> },
    { header: '兌換專用', render: (s) => <span className="font-semibold">{s.redeemOnly}</span> },
    {
      header: '操作',
      render: (s) => (
        <button
          className="text-brandDark hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(s.id);
          }}
        >
          明細
        </button>
      ),
    },
  ];

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
    { header: '加分老師', render: (r) => r.teacher?.user.name ?? '-' },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">集點管理</h1>

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="w-48">
            <option value="">全部班級</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            placeholder="搜尋姓名或學號…"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className="w-56"
          />
          <div className="ml-auto flex gap-3 text-xs">
            <button
              type="button"
              className="text-brandDark hover:underline"
              onClick={() => setChecked(Object.fromEntries(filtered.map((s) => [s.id, true])))}
            >
              全選目前篩選（{filtered.length}）
            </button>
            <button type="button" className="text-inkMuted hover:underline" onClick={() => setChecked({})}>
              清除選取
            </button>
          </div>
        </div>

        <DataTable
          columns={summaryColumns}
          rows={filtered}
          keyField={(s) => s.id}
          loading={summariesLoading}
          onRowClick={(s) => setChecked((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
          rowClassName={(s) => (checked[s.id] ? 'bg-stripe cursor-pointer' : 'cursor-pointer hover:bg-stripe')}
        />

        <form onSubmit={handleBatchAward} className="mt-3 flex flex-wrap items-center gap-2 border-t border-borderSubtle pt-3">
          <span className="text-sm text-ink">
            已選 <span className="font-semibold">{checkedIds.length}</span> 人
          </span>
          <Input
            type="number"
            min={1}
            max={10}
            value={batchAmount}
            onChange={(e) => setBatchAmount(e.target.value)}
            className="w-20"
            required
          />
          <Select value={batchReasonId} onChange={(e) => setBatchReasonId(e.target.value)} required className="w-56">
            <option value="">選擇加分理由</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button type="submit" loading={busy} disabled={checkedIds.length === 0 || reasons.length === 0}>
            批量加分
          </Button>
          {reasons.length === 0 && <span className="text-xs text-inkMuted">請先在下方建立加分理由</span>}
        </form>
      </Card>

      {selectedStudent && data && (
        <>
          <h2 className="mb-2 font-bold text-ink">
            {selectedStudent.name} 的點數明細
            <span className="ml-2 text-sm font-normal text-inkMuted">
              一般 {data.balances.regular} 點／兌換專用 {data.balances.redeemOnly} 點／合計 {total} 點
            </span>
          </h2>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <h3 className="mb-2 font-bold text-ink">兌換</h3>
              <form onSubmit={handleRedeem} className="flex flex-col gap-2">
                <Input
                  type="number"
                  min={1}
                  placeholder="扣多少點"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  required
                />
                <Input
                  placeholder="換了什麼（例如：文具組）"
                  value={redeemDescription}
                  onChange={(e) => setRedeemDescription(e.target.value)}
                  required
                />
                <p className="text-xs text-inkMuted">自動優先扣兌換專用點數，不足再扣一般點數</p>
                <Button type="submit" loading={busy}>
                  兌換並扣點
                </Button>
              </form>
            </Card>

            <Card>
              <h3 className="mb-2 font-bold text-ink">抽獎登記</h3>
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
              <h3 className="mb-2 font-bold text-ink">點數調整</h3>
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

          <Card className="mb-8">
            {data.history.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無點數紀錄</p>
            ) : (
              <DataTable columns={historyColumns} rows={data.history} keyField={(r) => r.id} />
            )}
          </Card>
        </>
      )}

      <PointReasonsManager />
    </>
  );
}
