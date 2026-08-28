'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import BillDetailBlock, { BillDetailJson } from '@/components/BillDetailBlock';

const KIND_LABEL: Record<'CLASS' | 'TUTORING', string> = { CLASS: '圍棋班級', TUTORING: '英數個別輔導' };

// 批次狀態徽章：跟主頁 admin/billing/page.tsx 裡的同名元件視覺一致，
// 沒有拆共用檔（只有這兩處用得到，各自內嵌一份）。
function BatchStatusBadge({ status }: { status: 'DRAFT' | 'FINALIZED' }) {
  return status === 'DRAFT' ? (
    <span className="inline-block whitespace-nowrap rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">草稿</span>
  ) : (
    <span className="inline-block whitespace-nowrap rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">
      已定案
    </span>
  );
}

interface SkippedRow {
  studentName: string;
  targetName: string;
  reason: string;
}

interface Payment {
  id: string;
  amount: number;
  paidOn: string;
  method: 'CASH' | 'TRANSFER';
}

interface BillRow {
  id: string;
  student: { id: string; user: { name: string } };
  class: { name: string } | null;
  classId: string | null;
  tutoringEnrollment: { program: { name: string }; feeTier: { name: string } | null } | null;
  tutoringEnrollmentId: string | null;
  billedSessions: number | null;
  unitPrice: number | null;
  amountDue: number;
  detail: BillDetailJson;
  payments: Payment[];
}

interface BatchDetail {
  id: string;
  kind: 'CLASS' | 'TUTORING';
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'FINALIZED';
  bills: BillRow[];
}

const ERROR_MESSAGES: Record<string, string> = {
  BILL_FINALIZED: '這筆帳單已定案，無法修改',
  BATCH_FINALIZED: '這個批次已定案，無法修改',
  MISSING_PRICE: '尚有班級未設定單價，請先設定後再定案',
};

export default function AdminBillingBatchPage({ params }: { params: { batchId: string } }) {
  const { batchId } = params;
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [billedSessionsDraft, setBilledSessionsDraft] = useState<Record<string, string>>({});
  const [savingBillId, setSavingBillId] = useState<string | null>(null);
  const [deletingBillId, setDeletingBillId] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/billing/batches/${batchId}`);
      setBatch(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  // 開新批次那一步送出的略過名單沒有入庫，靠 wizard 存進 sessionStorage 帶過來。
  useEffect(() => {
    const raw = sessionStorage.getItem(`billing-skipped-${batchId}`);
    if (!raw) return;
    try {
      setSkipped(JSON.parse(raw));
    } catch {
      setSkipped([]);
    }
  }, [batchId]);

  useEffect(() => {
    if (!batch) return;
    setBilledSessionsDraft((prev) => {
      const next = { ...prev };
      for (const b of batch.bills) {
        if (b.billedSessions !== null && next[b.id] === undefined) next[b.id] = String(b.billedSessions);
      }
      return next;
    });
  }, [batch]);

  async function saveBilledSessions(bill: BillRow) {
    const raw = billedSessionsDraft[bill.id];
    const n = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0 || n === bill.billedSessions) return;
    setSavingBillId(bill.id);
    try {
      const res = await fetch(`/api/admin/billing/bills/${bill.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billedSessions: n }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(ERROR_MESSAGES[data.error] ?? '更新失敗，請稍後再試');
        return;
      }
      await load();
    } finally {
      setSavingBillId(null);
    }
  }

  async function deleteBill(bill: BillRow) {
    if (!(await confirm('確定要刪除這筆帳單嗎？', { danger: true }))) return;
    setDeletingBillId(bill.id);
    try {
      const res = await fetch(`/api/admin/billing/bills/${bill.id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('刪除失敗，請稍後再試');
        return;
      }
      showToast('已刪除');
      await load();
    } finally {
      setDeletingBillId(null);
    }
  }

  async function deleteDraftBatch() {
    if (!(await confirm('確定要刪除整個草稿批次嗎？此動作無法復原，批次內所有帳單都會一併刪除。', { danger: true }))) return;
    setDeletingBatch(true);
    try {
      const res = await fetch(`/api/admin/billing/batches/${batchId}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('刪除失敗，請稍後再試');
        return;
      }
      showToast('已刪除草稿');
      router.push('/admin/billing');
    } finally {
      setDeletingBatch(false);
    }
  }

  async function finalize(notifyNow: boolean) {
    setFinalizing(true);
    try {
      const res = await fetch(`/api/admin/billing/batches/${batchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNow }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '定案失敗，請稍後再試');
        return;
      }
      setFinalizeModalOpen(false);
      showToast('已定案');
      await load();
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-inkMuted">載入中…</p>;
  }

  if (!batch) {
    return (
      <>
        <Link href="/admin/billing" className="mb-4 inline-block text-sm text-inkMuted hover:text-ink hover:underline">
          ← 返回收費主頁
        </Link>
        <p className="text-sm text-inkMuted">找不到這筆批次。</p>
      </>
    );
  }

  const targetCount =
    batch.kind === 'CLASS'
      ? new Set(batch.bills.map((b) => b.classId).filter(Boolean)).size
      : new Set(batch.bills.map((b) => b.tutoringEnrollment?.program.name).filter(Boolean)).size;
  const studentCount = new Set(batch.bills.map((b) => b.student.id)).size;
  const totalDue = batch.bills.reduce((s, b) => s + b.amountDue, 0);

  const header = (
    <>
      <Link href="/admin/billing" className="mb-1 inline-block text-sm text-inkMuted hover:text-ink hover:underline">
        收費 ›
      </Link>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-ink">{KIND_LABEL[batch.kind]}</h1>
        <BatchStatusBadge status={batch.status} />
      </div>
      <p className="mb-4 text-sm text-inkMuted">
        {formatDateWithWeekday(batch.periodStart)} ～ {formatDateWithWeekday(batch.periodEnd)}＋{targetCount} 個
        {batch.kind === 'CLASS' ? '班級' : '課程'}＋{studentCount} 位學生
      </p>
    </>
  );

  if (batch.status === 'FINALIZED') {
    const totalPaid = batch.bills.reduce((s, b) => s + b.payments.reduce((p, x) => p + x.amount, 0), 0);
    return (
      <>
        {header}
        <Card>
          <p className="text-sm text-ink">
            共 {batch.bills.length} 筆帳單・總應收 {totalDue.toLocaleString('en-US')} 元・已收 {totalPaid.toLocaleString('en-US')} 元・未收{' '}
            {(totalDue - totalPaid).toLocaleString('en-US')} 元
          </p>
          <p className="mt-2 text-xs text-inkMuted">已定案。收款登記／通知／催繳／結算功能即將上線。</p>
        </Card>
      </>
    );
  }

  const hasMissingPrice = batch.kind === 'CLASS' && batch.bills.some((b) => b.unitPrice === null);

  const columns: Column<BillRow>[] =
    batch.kind === 'CLASS'
      ? [
          { header: '學生', render: (b) => b.student.user.name, sortValue: (b) => b.student.user.name },
          { header: '班級', render: (b) => b.class?.name ?? '-' },
          {
            header: '計費堂數',
            render: (b) => (
              <Input
                type="number"
                min={0}
                value={billedSessionsDraft[b.id] ?? ''}
                onChange={(e) => setBilledSessionsDraft((prev) => ({ ...prev, [b.id]: e.target.value }))}
                onBlur={() => saveBilledSessions(b)}
                disabled={savingBillId === b.id}
                className="w-20 text-center"
              />
            ),
          },
          {
            header: '單價',
            render: (b) => (b.unitPrice === null ? <span className="font-semibold text-rejected">未設定</span> : `${b.unitPrice} 元`),
          },
          {
            header: '金額',
            render: (b) =>
              b.unitPrice === null ? (
                <span className="font-semibold text-rejected">請先設定班級單價</span>
              ) : (
                `${b.amountDue.toLocaleString('en-US')} 元`
              ),
            sortValue: (b) => b.amountDue,
          },
          {
            header: '明細',
            render: (b) => (
              <button
                type="button"
                onClick={() => setExpandedBillId((prev) => (prev === b.id ? null : b.id))}
                className="cursor-pointer text-sm font-medium text-brandDark hover:underline"
              >
                {expandedBillId === b.id ? '收合' : '展開'}
              </button>
            ),
          },
          {
            header: '刪除',
            render: (b) => (
              <Button variant="secondary" className="px-2 py-1 text-xs" loading={deletingBillId === b.id} onClick={() => deleteBill(b)}>
                刪除
              </Button>
            ),
          },
        ]
      : [
          { header: '學生', render: (b) => b.student.user.name, sortValue: (b) => b.student.user.name },
          { header: '課程', render: (b) => b.tutoringEnrollment?.program.name ?? '-' },
          { header: '金額', render: (b) => `${b.amountDue.toLocaleString('en-US')} 元`, sortValue: (b) => b.amountDue },
          {
            header: '明細',
            render: (b) => (
              <button
                type="button"
                onClick={() => setExpandedBillId((prev) => (prev === b.id ? null : b.id))}
                className="cursor-pointer text-sm font-medium text-brandDark hover:underline"
              >
                {expandedBillId === b.id ? '收合' : '展開'}
              </button>
            ),
          },
          {
            header: '刪除',
            render: (b) => (
              <Button variant="secondary" className="px-2 py-1 text-xs" loading={deletingBillId === b.id} onClick={() => deleteBill(b)}>
                刪除
              </Button>
            ),
          },
        ];

  return (
    <>
      {header}

      {skipped.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-bold text-ink">略過名單</h2>
          <div className="flex flex-col gap-1">
            {skipped.map((s, i) => (
              <div key={i} className="rounded-lg bg-stripe px-3 py-2 text-sm text-inkMuted">
                {s.studentName}・{s.targetName}：{s.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={batch.bills}
          keyField={(b) => b.id}
          expandedKey={expandedBillId}
          renderExpanded={(b) => <BillDetailBlock detail={b.detail} />}
          emptyText="這個批次沒有帳單"
        />
      </Card>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">
          本批合計應收 {totalDue.toLocaleString('en-US')} 元（{batch.bills.length} 筆）
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {hasMissingPrice && <p className="text-xs font-medium text-rejected">尚有班級未設定單價，請先設定後再定案</p>}
          <Button variant="secondary" loading={deletingBatch} onClick={deleteDraftBatch}>
            刪除草稿
          </Button>
          <Button disabled={hasMissingPrice || batch.bills.length === 0} onClick={() => setFinalizeModalOpen(true)}>
            定案並通知家長
          </Button>
        </div>
      </div>

      <Modal open={finalizeModalOpen} onClose={() => setFinalizeModalOpen(false)} title="定案確認">
        <div className="flex flex-col gap-4">
          <p className="whitespace-pre-line text-sm text-ink">定案後帳單金額凍結並自動充值堂數。要立即推播通知全部家長嗎？</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setFinalizeModalOpen(false)} disabled={finalizing}>
              取消
            </Button>
            <Button variant="secondary" loading={finalizing} onClick={() => finalize(false)}>
              先不通知
            </Button>
            <Button loading={finalizing} onClick={() => finalize(true)}>
              立即通知
            </Button>
          </div>
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}
