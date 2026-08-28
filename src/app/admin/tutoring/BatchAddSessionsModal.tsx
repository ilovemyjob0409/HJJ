'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface EnrollmentRow {
  id: string;
  studentName: string;
  programName: string;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
  feeTierId: string | null;
}

interface FeeTierOption {
  id: string;
  name: string;
  sessionsPerWeek: number;
  monthlyFee: number;
}

// 批量加堂：每列自訂 +N、一次提交。送出的是「目前生效額度 + N」的絕對值，
// 走既有的 PATCH /api/tutoring-enrollments/[id]（updateEnrollment 會經過
// recordQuotaChange 留下生效歷史，扣堂紀錄的按月回推不受影響）。
export default function BatchAddSessionsModal({
  open,
  enrollments,
  feeTiers,
  onClose,
  onSaved,
}: {
  open: boolean;
  enrollments: EnrollmentRow[];
  feeTiers: FeeTierOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setAmounts({});
  }, [open]);

  const filledCount = enrollments.filter((r) => (amounts[r.id] ?? '').trim() !== '').length;

  async function submit() {
    const filled = enrollments.filter((r) => (amounts[r.id] ?? '').trim() !== '');
    const invalid = filled.filter((r) => {
      const n = Number(amounts[r.id]);
      return !Number.isInteger(n) || n <= 0;
    });
    if (invalid.length > 0) {
      showToast(`加堂數需為正整數：${invalid.map((r) => r.studentName).join('、')}`);
      return;
    }
    if (filled.length === 0) {
      showToast('請至少填一位學生的加堂數');
      return;
    }
    if (!(await confirm(`確定要為 ${filled.length} 位學生加堂嗎？`))) return;

    setSubmitting(true);
    try {
      const results = await Promise.all(
        filled.map(async (r) => {
          try {
            const res = await fetch(`/api/tutoring-enrollments/${r.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ monthlyQuota: r.monthlyQuota + Number(amounts[r.id]) }),
            });
            return { name: r.studentName, ok: res.ok };
          } catch {
            return { name: r.studentName, ok: false };
          }
        })
      );
      const failed = results.filter((r) => !r.ok);
      const succeeded = results.length - failed.length;
      if (failed.length === 0) {
        showToast(`已為 ${succeeded} 位學生加堂`);
        onClose();
      } else if (succeeded === 0) {
        showToast(`加堂失敗：${failed.map((f) => f.name).join('、')}`);
      } else {
        showToast(`已為 ${succeeded} 位學生加堂，${failed.length} 位失敗：${failed.map((f) => f.name).join('、')}`);
      }
      if (succeeded > 0) onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  const columns: Column<EnrollmentRow>[] = [
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    {
      header: '收費級距',
      render: (r) => {
        const tier = feeTiers.find((t) => t.id === r.feeTierId);
        return tier ? tier.name : <span className="text-inkMuted">未指定</span>;
      },
      sortValue: (r) => feeTiers.find((t) => t.id === r.feeTierId)?.name ?? '',
    },
    {
      header: '本月狀態',
      render: (r) => (
        <>
          已計次 {r.locked}／{r.monthlyQuota} 堂
          <br />
          <span className="text-xs text-inkMuted">（已預約 {r.upcoming} 堂）</span>
        </>
      ),
      sortValue: (r) => r.monthlyQuota - r.locked,
    },
    {
      header: '加堂數',
      render: (r) => (
        <Input
          type="number"
          min={1}
          placeholder="不加"
          aria-label={`${r.studentName} 加堂數`}
          value={amounts[r.id] ?? ''}
          onChange={(e) => setAmounts((prev) => ({ ...prev, [r.id]: e.target.value }))}
          className="w-20 py-1 text-sm"
        />
      ),
    },
  ];

  return (
    <>
      <Modal open={open} onClose={onClose} title="批量加堂" maxWidthClassName="max-w-2xl">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-inkMuted">加上去的堂數會直接提高該報名的每月堂數上限，之後如需調回請至各報名的每月堂數覆寫修改。</p>
          <DataTable columns={columns} rows={enrollments} keyField={(r) => r.id} emptyText="目前沒有有效的報名" />
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-inkMuted">已填 {filledCount} 位</span>
            <Button disabled={filledCount === 0} loading={submitting} onClick={submit}>
              一次提交
            </Button>
          </div>
        </div>
      </Modal>
      {ConfirmDialog}
    </>
  );
}
