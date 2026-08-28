'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

type Kind = 'CLASS' | 'TUTORING';

interface ClassOption {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  feePerSession: number | null;
}

interface ProgramOption {
  id: string;
  name: string;
  active: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_FIELDS: '請完整填寫收費區間',
};

// 台北時區的「這個月／下個月」——用來讓個輔月費批次一鍵帶出整月起訖，仍可手改。
function taipeiYearMonth(offsetMonths: number): { year: number; month: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(now);
  const [y, m] = parts.split('-').map(Number);
  const total = y * 12 + (m - 1) + offsetMonths;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function monthRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export default function BatchWizardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<Kind | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [selectedProgramIds, setSelectedProgramIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setKind(null);
    setPeriodStart('');
    setPeriodEnd('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/classes')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ClassOption[]) => {
        setClasses(data);
        setSelectedClassIds(new Set(data.map((c) => c.id)));
      });
    fetch('/api/tutoring-programs')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProgramOption[]) => {
        const activeOnly = data.filter((p) => p.active);
        setPrograms(activeOnly);
        setSelectedProgramIds(new Set(activeOnly.map((p) => p.id)));
      });
  }, [open]);

  const canGoStep2 = kind !== null;
  const selectedCount = kind === 'CLASS' ? selectedClassIds.size : selectedProgramIds.size;
  const canGoStep3 = selectedCount > 0;
  const periodValid = periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd;

  function toggleClass(id: string) {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProgram(id: string) {
    setSelectedProgramIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (kind === 'CLASS') setSelectedClassIds(new Set(classes.map((c) => c.id)));
    else setSelectedProgramIds(new Set(programs.map((p) => p.id)));
  }

  function clearAll() {
    if (kind === 'CLASS') setSelectedClassIds(new Set());
    else setSelectedProgramIds(new Set());
  }

  function applyMonth(offsetMonths: number) {
    const { year, month } = taipeiYearMonth(offsetMonths);
    const { start, end } = monthRange(year, month);
    setPeriodStart(start);
    setPeriodEnd(end);
  }

  async function handleSubmit() {
    if (!kind || selectedCount === 0) {
      showToast('請至少選擇一項');
      return;
    }
    if (!periodValid) {
      showToast('請完整填寫收費區間');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/billing/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          periodStart,
          periodEnd,
          ...(kind === 'CLASS' ? { classIds: Array.from(selectedClassIds) } : { programIds: Array.from(selectedProgramIds) }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '開單失敗，請稍後再試');
        return;
      }
      sessionStorage.setItem(`billing-skipped-${data.batchId}`, JSON.stringify(data.skipped ?? []));
      onClose();
      router.push(`/admin/billing/${data.batchId}`);
    } finally {
      setSubmitting(false);
    }
  }

  const title = step === 1 ? '開新批次・選擇種類' : step === 2 ? '開新批次・選擇對象' : '開新批次・收費區間';

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClassName="max-w-lg">
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {(['CLASS', 'TUTORING'] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`cursor-pointer rounded-xl border p-4 text-left transition-colors ${
                  kind === k ? 'border-brandDark bg-brand/10' : 'border-borderStrong bg-card hover:bg-stripe'
                }`}
              >
                <p className="font-bold text-ink">{k === 'CLASS' ? '圍棋班級' : '英數個別輔導'}</p>
                <p className="mt-1 text-xs text-inkMuted">{k === 'CLASS' ? '依班級每堂單價計費' : '依收費級距按月計費'}</p>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button disabled={!canGoStep2} onClick={() => setStep(2)}>
              下一步
            </Button>
          </div>
        </div>
      )}

      {step === 2 && kind && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">
              {kind === 'CLASS' ? '選擇要開單的班級' : '選擇要開單的課程'}（已選 {selectedCount} 項）
            </p>
            <div className="flex gap-1">
              <button type="button" onClick={selectAll} className="cursor-pointer text-xs text-brandDark hover:underline">
                全選
              </button>
              <span className="text-xs text-inkMuted">・</span>
              <button type="button" onClick={clearAll} className="cursor-pointer text-xs text-brandDark hover:underline">
                取消全選
              </button>
            </div>
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-borderSubtle p-2">
            {kind === 'CLASS'
              ? classes.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-stripe">
                    <input type="checkbox" checked={selectedClassIds.has(c.id)} onChange={() => toggleClass(c.id)} />
                    <span>
                      {c.name}（{c.subject}・週{WEEKDAY_LABELS[c.weekday]}・單價{' '}
                      {c.feePerSession === null ? '500 元（預設）' : `${c.feePerSession} 元`}）
                    </span>
                  </label>
                ))
              : programs.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-stripe">
                    <input type="checkbox" checked={selectedProgramIds.has(p.id)} onChange={() => toggleProgram(p.id)} />
                    <span>{p.name}</span>
                  </label>
                ))}
            {(kind === 'CLASS' ? classes.length : programs.length) === 0 && (
              <p className="px-2 py-1.5 text-sm text-inkMuted">目前沒有可選的項目</p>
            )}
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button disabled={!canGoStep3} onClick={() => setStep(3)}>
              下一步
            </Button>
          </div>
        </div>
      )}

      {step === 3 && kind && (
        <div className="flex flex-col gap-3">
          {kind === 'TUTORING' && (
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => applyMonth(0)}>
                本月
              </Button>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => applyMonth(1)}>
                下月
              </Button>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm text-ink">
            收費區間起
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            收費區間訖
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          {periodStart && periodEnd && periodStart > periodEnd && <p className="text-xs text-rejected">起日不能晚於訖日</p>}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(2)}>
              上一步
            </Button>
            <Button loading={submitting} disabled={!periodValid} onClick={handleSubmit}>
              建立批次
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
