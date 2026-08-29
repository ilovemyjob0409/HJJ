'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import DataTable, { Column } from '@/components/ui/DataTable';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday, formatTimestampWithWeekdayTaipei } from '@/lib/dateFormat';
import { getPaidState } from '@/lib/billingCalc';
import BillDetailBlock, { BillDetailJson } from '@/components/BillDetailBlock';
import ActionMenu, { ActionMenuItem } from '@/components/ui/ActionMenu';
import PaymentModal from '../PaymentModal';
import SettleModal from '../SettleModal';

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
  note: string | null;
}

interface BillRow {
  id: string;
  student: { id: string; user: { name: string } };
  class: { name: string } | null;
  classId: string | null;
  tutoringEnrollment: { program: { name: string }; feeTier: { name: string } | null } | null;
  tutoringEnrollmentId: string | null;
  periodStart: string;
  periodEnd: string;
  billedSessions: number | null;
  unitPrice: number | null;
  amountDue: number;
  detail: BillDetailJson;
  payments: Payment[];
  notifiedAt: string | null;
  settledAsWithdrawal: boolean;
}

const PAID_STATE_CONFIG: Record<'UNPAID' | 'PARTIAL' | 'PAID', { label: string; bg: string; text: string }> = {
  UNPAID: { label: '未繳', bg: 'bg-rejectedBg', text: 'text-rejected' },
  PARTIAL: { label: '部分繳', bg: 'bg-pendingBg', text: 'text-pending' },
  PAID: { label: '繳清', bg: 'bg-approvedBg', text: 'text-approved' },
};

// 跟主頁 admin/billing/page.tsx 的同名元件視覺一致——page.tsx 是 Next.js 特殊路由檔，
// 不能 export 一般元件供這裡 import，所以跟 BatchStatusBadge 一樣各自內嵌一份。
function PaidStateBadge({ amountDue, payments }: { amountDue: number; payments: { amount: number }[] }) {
  const { state } = getPaidState(amountDue, payments);
  const { label, bg, text } = PAID_STATE_CONFIG[state];
  return <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
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
  BILL_NOT_FINALIZED: '尚有帳單非已定案狀態，無法通知',
  ALREADY_PAID: '這筆帳單已繳清，不需提醒繳費',
  PARTIAL_TOPUP_FAILURE: '定案成功，但部分學生的堂數補登失敗，請檢查該生報名狀態後手動補登',
  BILL_HAS_PAYMENTS: '這筆帳單已有繳款紀錄，請先處理繳款後再刪除',
  BILL_CREDITS_SESSIONS: '這筆班級帳單已把堂數計入學生總堂數，無法直接刪除，請聯絡工程處理',
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
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [notifying, setNotifying] = useState<'selected' | 'all' | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null);
  const [settleBillId, setSettleBillId] = useState<string | null>(null);

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
    if (!(await confirm('確定要刪除這筆帳單嗎？此動作無法復原。', { danger: true }))) return;
    setDeletingBillId(bill.id);
    try {
      const res = await fetch(`/api/admin/billing/bills/${bill.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(ERROR_MESSAGES[data.error] ?? '刪除失敗，請稍後再試');
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
        // PARTIAL_TOPUP_FAILURE 時批次其實已經定案成功（只是部分學生補堂失敗），
        // 畫面仍留在草稿視圖會誤導管理員；重新載入讓畫面跟真實狀態一致。
        if (data.error === 'PARTIAL_TOPUP_FAILURE') {
          setFinalizeModalOpen(false);
          await load();
        }
        return;
      }
      setFinalizeModalOpen(false);
      showToast('已定案');
      await load();
    } finally {
      setFinalizing(false);
    }
  }

  async function notifyBillIds(ids: string[]): Promise<boolean> {
    const res = await fetch('/api/admin/billing/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billIds: ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(ERROR_MESSAGES[data.error] ?? '通知失敗，請稍後再試');
      return false;
    }
    return true;
  }

  async function notifySelected() {
    if (!batch) return;
    const ids = batch.bills.filter((b) => checkedIds[b.id]).map((b) => b.id);
    if (ids.length === 0) return;
    if (!(await confirm(`確定要通知這 ${ids.length} 筆帳單的家長嗎？`))) return;
    setNotifying('selected');
    try {
      if (await notifyBillIds(ids)) {
        showToast('已通知');
        setCheckedIds({});
        await load();
      }
    } finally {
      setNotifying(null);
    }
  }

  async function notifyAllUnnotified() {
    if (!batch) return;
    const ids = batch.bills.filter((b) => !b.notifiedAt).map((b) => b.id);
    if (ids.length === 0) return;
    if (!(await confirm(`確定要通知所有 ${ids.length} 筆尚未通知的家長嗎？`))) return;
    setNotifying('all');
    try {
      if (await notifyBillIds(ids)) {
        showToast('已通知');
        await load();
      }
    } finally {
      setNotifying(null);
    }
  }

  async function remindBill(billId: string) {
    setRemindingId(billId);
    try {
      const res = await fetch(`/api/admin/billing/bills/${billId}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '提醒繳費失敗，請稍後再試');
        return;
      }
      showToast('已發送提醒繳費通知');
    } finally {
      setRemindingId(null);
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
    const checkedCount = batch.bills.filter((b) => checkedIds[b.id]).length;
    const unnotifiedCount = batch.bills.filter((b) => !b.notifiedAt).length;
    const allChecked = batch.bills.length > 0 && checkedCount === batch.bills.length;
    const paymentBill = batch.bills.find((b) => b.id === paymentBillId) ?? null;
    const settleTargetBill = batch.bills.find((b) => b.id === settleBillId) ?? null;

    const finalizedColumns: Column<BillRow>[] = [
      {
        header: (
          <input
            type="checkbox"
            aria-label="全選"
            checked={allChecked}
            onChange={() =>
              setCheckedIds(allChecked ? {} : Object.fromEntries(batch.bills.map((b) => [b.id, true])))
            }
          />
        ),
        render: (b) => (
          <input
            type="checkbox"
            checked={!!checkedIds[b.id]}
            onChange={() => setCheckedIds((prev) => ({ ...prev, [b.id]: !prev[b.id] }))}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      { header: '學生', render: (b) => b.student.user.name, sortValue: (b) => b.student.user.name },
      {
        header: '班級/課程',
        render: (b) => (batch.kind === 'CLASS' ? b.class?.name : b.tutoringEnrollment?.program.name) ?? '-',
      },
      {
        header: '金額',
        render: (b) => (
          <span>
            {b.amountDue.toLocaleString('en-US')} 元
            {b.settledAsWithdrawal && <span className="ml-1 text-xs text-inkMuted">已結算（退班）</span>}
          </span>
        ),
        sortValue: (b) => b.amountDue,
      },
      {
        header: '已繳',
        render: (b) => `${getPaidState(b.amountDue, b.payments).paid.toLocaleString('en-US')} 元`,
        sortValue: (b) => getPaidState(b.amountDue, b.payments).paid,
      },
      {
        header: '待繳',
        render: (b) => {
          const { outstanding } = getPaidState(b.amountDue, b.payments);
          return <span className={outstanding > 0 ? 'font-semibold text-rejected' : ''}>{outstanding.toLocaleString('en-US')} 元</span>;
        },
        sortValue: (b) => getPaidState(b.amountDue, b.payments).outstanding,
      },
      { header: '繳費狀態', render: (b) => <PaidStateBadge amountDue={b.amountDue} payments={b.payments} /> },
      {
        header: '通知',
        render: (b) =>
          b.notifiedAt ? (
            <span className="text-ink">已通知・{formatTimestampWithWeekdayTaipei(b.notifiedAt)}</span>
          ) : (
            <span className="text-inkMuted">未通知</span>
          ),
        sortValue: (b) => b.notifiedAt,
      },
      {
        header: '操作',
        render: (b) => {
          const { state } = getPaidState(b.amountDue, b.payments);
          // 提醒繳費只在系統判定已通知過（notifiedAt 有值）且未繳清時顯示；
          // 未通知過的走上方整批通知，不在這裡重複一個「通知」項目。
          const remindItem: ActionMenuItem | null =
            b.notifiedAt && state !== 'PAID'
              ? { key: 'remind', label: '提醒繳費', loading: remindingId === b.id, onClick: () => remindBill(b.id) }
              : null;
          // 刪除鈕預先擋掉班級帳單已充值堂數的情況（跟服務層的 BILL_CREDITS_SESSIONS
          // 是同一條規則，這裡先隱藏選項給更直接的引導；已有繳款的情況沒有預先擋，
          // 讓伺服器的 BILL_HAS_PAYMENTS 錯誤訊息說明原因即可）。
          const canDelete = !(b.classId && (b.billedSessions ?? 0) > 0);
          return (
            <div className="flex justify-center">
              <ActionMenu
                items={[
                  { key: 'payment', label: '繳款', onClick: () => setPaymentBillId(b.id) },
                  ...(remindItem ? [remindItem] : []),
                  ...(b.settledAsWithdrawal ? [] : [{ key: 'settle', label: '退班結算', onClick: () => setSettleBillId(b.id) }]),
                  ...(canDelete
                    ? [{ key: 'delete', label: '刪除帳單', tone: 'danger' as const, loading: deletingBillId === b.id, onClick: () => deleteBill(b) }]
                    : []),
                ]}
              />
            </div>
          );
        },
      },
    ];

    const exportColumns = [
      { header: '學生', value: (b: BillRow) => b.student.user.name },
      { header: '班級', value: (b: BillRow) => (batch.kind === 'CLASS' ? b.class?.name : b.tutoringEnrollment?.program.name) ?? '-' },
      { header: '區間', value: (b: BillRow) => `${formatDateWithWeekday(b.periodStart)}～${formatDateWithWeekday(b.periodEnd)}` },
      { header: '堂數', value: (b: BillRow) => b.billedSessions ?? '-' },
      { header: '單價', value: (b: BillRow) => b.unitPrice ?? '-' },
      { header: '金額', value: (b: BillRow) => b.amountDue },
      { header: '已繳', value: (b: BillRow) => getPaidState(b.amountDue, b.payments).paid },
      { header: '待繳', value: (b: BillRow) => getPaidState(b.amountDue, b.payments).outstanding },
      { header: '繳費狀態', value: (b: BillRow) => PAID_STATE_CONFIG[getPaidState(b.amountDue, b.payments).state].label },
      { header: '通知時間', value: (b: BillRow) => (b.notifiedAt ? formatTimestampWithWeekdayTaipei(b.notifiedAt) : '未通知') },
    ];

    return (
      <>
        {header}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={checkedCount === 0} loading={notifying === 'selected'} onClick={notifySelected}>
              通知勾選家長（{checkedCount}）
            </Button>
            <Button
              variant="secondary"
              disabled={unnotifiedCount === 0}
              loading={notifying === 'all'}
              onClick={notifyAllUnnotified}
            >
              一鍵通知所有未通知（{unnotifiedCount}）
            </Button>
          </div>
          <ExportExcelButton
            rows={batch.bills}
            columns={exportColumns}
            filename={`收費批次_${batch.periodStart.slice(0, 10)}~${batch.periodEnd.slice(0, 10)}`}
          />
        </div>

        <Card>
          <DataTable
            columns={finalizedColumns}
            rows={batch.bills}
            keyField={(b) => b.id}
            onRowClick={(b) => setExpandedBillId((prev) => (prev === b.id ? null : b.id))}
            rowClassName={() => 'cursor-pointer'}
            expandedKey={expandedBillId}
            renderExpanded={(b) => <BillDetailBlock detail={b.detail} />}
            emptyText="這個批次沒有帳單"
          />
        </Card>

        <p className="mt-4 text-sm text-ink">
          共 {batch.bills.length} 筆帳單・總應收 {totalDue.toLocaleString('en-US')} 元・已收 {totalPaid.toLocaleString('en-US')} 元・未收{' '}
          {(totalDue - totalPaid).toLocaleString('en-US')} 元
        </p>

        <PaymentModal bill={paymentBill} onClose={() => setPaymentBillId(null)} onChanged={load} />
        <SettleModal bill={settleTargetBill} onClose={() => setSettleBillId(null)} onChanged={load} />

        {ConfirmDialog}
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
