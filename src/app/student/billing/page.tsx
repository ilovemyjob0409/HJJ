'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import BillDetailBlock, { BillDetailJson } from '@/components/BillDetailBlock';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface BillPayment {
  amount: number;
  paidOn: string;
  method: 'CASH' | 'TRANSFER';
}

interface Bill {
  id: string;
  studentName: string;
  isSelf: boolean;
  targetName: string;
  periodStart: string;
  periodEnd: string;
  amountDue: number;
  paid: number;
  outstanding: number;
  state: 'UNPAID' | 'PARTIAL' | 'PAID';
  detail: BillDetailJson;
  payments: BillPayment[];
}

const METHOD_LABEL: Record<'CASH' | 'TRANSFER', string> = { CASH: '現金', TRANSFER: '轉帳' };

// 繳費狀態徽章：配色跟 /admin/billing 頁面的 PaidStateBadge 同一套（未繳＝紅／部分繳＝
// 黃／繳清＝綠）。那邊的元件是模組私有、沒有匯出，這裡狀態又是 API 直接算好回傳（不像
// 那邊還要吃 amountDue/payments 呼叫 getPaidState），所以在這裡另外放一份同樣的映射，
// 不強行共用。
const PAID_STATE_CONFIG: Record<'UNPAID' | 'PARTIAL' | 'PAID', { label: string; bg: string; text: string }> = {
  UNPAID: { label: '未繳', bg: 'bg-rejectedBg', text: 'text-rejected' },
  PARTIAL: { label: '部分繳', bg: 'bg-pendingBg', text: 'text-pending' },
  PAID: { label: '繳清', bg: 'bg-approvedBg', text: 'text-approved' },
};

function PaidStateBadge({ state }: { state: 'UNPAID' | 'PARTIAL' | 'PAID' }) {
  const { label, bg, text } = PAID_STATE_CONFIG[state];
  return <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
}

// 繳款紀錄逐筆：「日期（週N） 方式 金額 元」。payments 為空時不渲染任何東西（連外層容器
// 都不留），避免呼叫端還要另外判斷是否留白。
function PaymentLines({ payments, className = '' }: { payments: BillPayment[]; className?: string }) {
  if (payments.length === 0) return null;
  return (
    <div className={`flex flex-col gap-0.5 text-xs text-inkMuted ${className}`}>
      {payments.map((p, i) => (
        <p key={i}>
          {formatDateWithWeekday(p.paidOn)} {METHOD_LABEL[p.method]} {p.amount.toLocaleString('en-US')} 元
        </p>
      ))}
    </div>
  );
}

// 學生姓名小標籤：手足帳單合併顯示時標示這筆是誰的（自己＝品牌色、手足＝藍）。
function StudentNameBadge({ bill }: { bill: Bill }) {
  return (
    <span
      className={`mr-1.5 inline-block rounded-md px-2 py-0.5 align-middle text-xs font-semibold ${
        bill.isSelf ? 'bg-brand text-brandInk' : 'bg-assignedBg text-assigned'
      }`}
    >
      {bill.studentName}
    </span>
  );
}

function PendingBillCard({ bill, showStudent }: { bill: Bill; showStudent: boolean }) {
  return (
    <Card className="mb-4">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-ink">
            {showStudent && <StudentNameBadge bill={bill} />}
            {bill.targetName}
          </p>
          <p className="mt-0.5 text-xs text-inkMuted">
            {formatDateWithWeekday(bill.periodStart)} ～ {formatDateWithWeekday(bill.periodEnd)}
          </p>
        </div>
        <PaidStateBadge state={bill.state} />
      </div>
      <div className="my-2.5 flex flex-wrap items-baseline gap-2.5">
        <span className="text-brand text-2xl font-bold">{bill.amountDue.toLocaleString('en-US')} 元</span>
        <span className="text-xs text-inkMuted">
          已繳 {bill.paid.toLocaleString('en-US')}・待繳{' '}
          <span className="font-semibold text-rejected">{bill.outstanding.toLocaleString('en-US')}</span>
        </span>
      </div>
      <BillDetailBlock detail={bill.detail} />
      <PaymentLines payments={bill.payments} className="mt-2.5" />
    </Card>
  );
}

export default function StudentBillingPage() {
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState('');
  const [bills, setBills] = useState<Bill[]>([]);
  const [hasSiblings, setHasSiblings] = useState(false);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/billing/me');
        if (res.ok) {
          const data = await res.json();
          setPaymentInfo(data.paymentInfo);
          setBills(data.bills);
          setHasSiblings(data.hasSiblings);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const pendingBills = bills.filter((b) => b.state !== 'PAID');

  const recordColumns: Column<Bill>[] = [
    ...(hasSiblings
      ? [{ header: '學生', render: (b: Bill) => b.studentName, sortValue: (b: Bill) => b.studentName } satisfies Column<Bill>]
      : []),
    { header: '項目', render: (b) => b.targetName, sortValue: (b) => b.targetName },
    {
      header: '區間',
      width: 'w-64',
      render: (b) => (
        <span className="whitespace-nowrap">
          {formatDateWithWeekday(b.periodStart)} ～ {formatDateWithWeekday(b.periodEnd)}
        </span>
      ),
      sortValue: (b) => b.periodStart,
    },
    { header: '金額', render: (b) => `${b.amountDue.toLocaleString('en-US')} 元`, sortValue: (b) => b.amountDue },
    { header: '狀態', render: (b) => <PaidStateBadge state={b.state} /> },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">繳費</h1>

      <Card className="mb-6">
        <p className="mb-2 text-xs font-bold text-inkMuted">繳費方式</p>
        {loading ? (
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer h-4 w-56 rounded" />
          </div>
        ) : (
          <>
            <p className="text-sm text-ink">現金（櫃檯）／銀行轉帳</p>
            {paymentInfo && (
              <div className="mt-2.5 whitespace-pre-line border-t border-borderSubtle pt-2.5 text-sm text-ink">{paymentInfo}</div>
            )}
          </>
        )}
      </Card>

      <h2 className="mb-2 font-bold text-ink">待繳帳單</h2>
      {loading ? (
        <Card className="mb-6">
          <div className="flex flex-col gap-3">
            <div className="skeleton-shimmer h-5 w-32 rounded" />
            <div className="skeleton-shimmer h-8 w-40 rounded" />
            <div className="skeleton-shimmer h-16 w-full rounded" />
          </div>
        </Card>
      ) : pendingBills.length === 0 ? (
        <Card className="mb-6">
          <p className="py-4 text-center text-sm text-inkMuted">目前沒有待繳帳單</p>
        </Card>
      ) : (
        <div className="mb-6">
          {pendingBills.map((bill) => (
            <PendingBillCard key={bill.id} bill={bill} showStudent={hasSiblings} />
          ))}
        </div>
      )}

      <h2 className="mb-2 font-bold text-ink">繳費紀錄</h2>
      <Card>
        <CollapsibleDataTable
          columns={recordColumns}
          rows={bills}
          keyField={(b) => b.id}
          onRowClick={(b) => setExpandedBillId((prev) => (prev === b.id ? null : b.id))}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          expandedKey={expandedBillId}
          renderExpanded={(b) => (
            <div className="flex flex-col gap-3">
              <BillDetailBlock detail={b.detail} />
              <PaymentLines payments={b.payments} />
            </div>
          )}
          loading={loading}
          maxRows={3}
          emptyText="目前沒有繳費紀錄"
        />
      </Card>
    </>
  );
}
