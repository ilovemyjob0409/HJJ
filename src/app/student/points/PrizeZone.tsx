'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import AlertModal from '@/components/ui/AlertModal';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday, formatTimestampWithWeekdayTaipei } from '@/lib/dateFormat';

interface Prize {
  id: string;
  name: string;
  points: number;
  stock: number;
  imageUrl: string | null;
  alreadyRedeemed: boolean;
}

interface Redemption {
  id: string;
  prizeName: string;
  points: number;
  status: string;
  createdAt: Date;
  deadlineKey: string;
}

interface SuccessInfo {
  prizeName: string;
  points: number;
  deadlineKey: string;
}

interface ErrorInfo {
  title: string;
  message: string;
}

// 兌換業務錯誤碼 → 中文；不得把原始錯誤碼／Prisma 錯誤顯示給使用者。
const ERROR_LABELS: Record<string, string> = {
  PRIZE_UNAVAILABLE: '這個獎品目前無法兌換',
  OUT_OF_STOCK: '這個獎品已經換完了',
  ALREADY_REDEEMED: '你已經兌換過這個獎品囉',
  INSUFFICIENT_POINTS: '點數不夠，再多集一點吧！',
  NOT_PENDING: '這筆兌換已經處理過了',
  NOT_FOUND: '找不到這筆兌換紀錄',
};

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? '發生錯誤，請稍後再試';
}

// 兌換紀錄狀態徽章：跟 StatusBadge 同一套視覺（pill＋bg/text 色），但這四種
// 狀態（待領獎/已領取/已取消/已逾期）是 PrizeRedemption 專屬，不進共用元件。
const REDEMPTION_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PENDING: { label: '待領獎', bg: 'bg-pendingBg', text: 'text-pending' },
  PICKED_UP: { label: '已領取', bg: 'bg-approvedBg', text: 'text-approved' },
  CANCELLED: { label: '已取消', bg: 'bg-borderSubtle', text: 'text-inkMuted' },
  EXPIRED: { label: '已逾期', bg: 'bg-rejectedBg', text: 'text-rejected' },
};

// 集點卡頁的獎品專區：獎品目錄（自助兌換）＋我的兌換紀錄。props 由 server
// page 傳入，mutation 成功後 router.refresh() 重抓最新的 server 資料
// （餘額／目錄／紀錄都要一起更新，不在 client 端自己拼算）。
export default function PrizeZone({ prizes, redemptions, total }: { prizes: Prize[]; redemptions: Redemption[]; total: number }) {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

  async function handleRedeem(prize: Prize) {
    const ok = await confirm(`確定用 ${prize.points} 點兌換「${prize.name}」嗎？`);
    if (!ok) return;
    setRedeemingId(prize.id);
    try {
      const res = await fetch('/api/prize-redemptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizeId: prize.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorInfo({ title: '兌換失敗', message: errorLabel(data.error) });
        return;
      }
      setSuccessInfo({ prizeName: data.prizeName, points: data.points, deadlineKey: data.deadlineKey });
      router.refresh();
    } finally {
      setRedeemingId(null);
    }
  }

  async function handleCancel(redemption: Redemption) {
    const ok = await confirm(`確定要取消兌換「${redemption.prizeName}」嗎？已使用的點數將會退回。`, { danger: true });
    if (!ok) return;
    setCancellingId(redemption.id);
    try {
      const res = await fetch(`/api/prize-redemptions/${redemption.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setErrorInfo({ title: '取消失敗', message: errorLabel(data.error) });
        return;
      }
      router.refresh();
    } finally {
      setCancellingId(null);
    }
  }

  const columns: Column<Redemption>[] = [
    { header: '獎品', render: (r) => r.prizeName, sortValue: (r) => r.prizeName },
    {
      header: '點數',
      render: (r) => <span className="font-semibold text-brandDark">{r.points}</span>,
      sortValue: (r) => r.points,
    },
    {
      header: '狀態',
      render: (r) => {
        const cfg = REDEMPTION_STATUS_CONFIG[r.status] ?? { label: r.status, bg: 'bg-borderSubtle', text: 'text-inkMuted' };
        return (
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
        );
      },
      sortValue: (r) => r.status,
    },
    {
      header: '領取期限',
      render: (r) => (r.status === 'PENDING' ? formatDateWithWeekday(r.deadlineKey) : '—'),
      sortValue: (r) => r.deadlineKey,
    },
    {
      header: '兌換時間',
      render: (r) => formatTimestampWithWeekdayTaipei(r.createdAt),
      sortValue: (r) => r.createdAt,
    },
    {
      header: '操作',
      render: (r) =>
        r.status === 'PENDING' ? (
          <Button variant="link" tone="danger" loading={cancellingId === r.id} onClick={() => handleCancel(r)}>
            取消
          </Button>
        ) : (
          <span className="text-inkMuted">-</span>
        ),
    },
  ];

  return (
    <>
      <h2 className="mb-2 font-bold text-ink">獎品目錄</h2>
      <Card className="mb-6">
        {prizes.length === 0 ? (
          <p className="text-sm text-inkMuted">目前沒有可兌換的獎品</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {prizes.map((prize) => {
              const shortBy = prize.points - total;
              return (
                <div key={prize.id} className="relative flex flex-col gap-2 rounded-lg border border-borderSubtle p-3">
                  {prize.alreadyRedeemed ? (
                    <span className="absolute right-2 top-2 rounded-full bg-approvedBg px-2 py-0.5 text-xs font-bold text-approved">
                      已兌換
                    </span>
                  ) : prize.stock === 0 ? (
                    <span className="absolute right-2 top-2 rounded-full bg-rejectedBg px-2 py-0.5 text-xs font-bold text-rejected">
                      已換完
                    </span>
                  ) : null}

                  {prize.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
                    <img src={prize.imageUrl}
                  loading="lazy"
                  decoding="async" alt={prize.name} className="h-24 w-full rounded object-cover" />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center rounded bg-stripe text-3xl" aria-hidden="true">
                      🎁
                    </div>
                  )}

                  <p className="truncate text-sm font-semibold text-ink" title={prize.name}>
                    {prize.name}
                  </p>
                  <p className="text-sm font-bold text-brandDark">{prize.points} 點</p>

                  {prize.alreadyRedeemed ? (
                    <Button variant="secondary" disabled className="w-full">
                      已兌換
                    </Button>
                  ) : prize.stock === 0 ? (
                    <Button variant="secondary" disabled className="w-full">
                      已換完
                    </Button>
                  ) : shortBy > 0 ? (
                    <Button variant="secondary" disabled className="w-full">
                      還差 {shortBy} 點
                    </Button>
                  ) : (
                    <Button loading={redeemingId === prize.id} onClick={() => handleRedeem(prize)} className="w-full">
                      兌換
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的兌換紀錄</h2>
      <Card className="mb-6">
        <CollapsibleDataTable columns={columns} rows={redemptions} keyField={(r) => r.id} maxRows={3} emptyText="尚無兌換紀錄" />
      </Card>

      <Modal open={successInfo !== null} onClose={() => setSuccessInfo(null)} title="兌換成功 🎉">
        {successInfo && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">
              <span className="font-semibold">{successInfo.prizeName}</span>（{successInfo.points} 點）
            </p>
            <p className="text-sm text-inkMuted">
              請於 {formatDateWithWeekday(successInfo.deadlineKey)} 前到櫃台領取，逾期將自動退回點數
            </p>
            <Button onClick={() => setSuccessInfo(null)} className="w-full">
              知道了
            </Button>
          </div>
        )}
      </Modal>

      <AlertModal open={errorInfo !== null} onClose={() => setErrorInfo(null)} title={errorInfo?.title ?? '發生錯誤'}>
        {errorInfo?.message}
      </AlertModal>

      {ConfirmDialog}
    </>
  );
}
