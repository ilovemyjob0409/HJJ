'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import BillDetailBlock, { BillDetailJson } from '@/components/BillDetailBlock';

interface StudentRow {
  id: string;
  studentNumber: string | null;
  user: { name: string };
}

interface ClassOption {
  id: string;
  name: string;
  enrollments: { studentId: string }[];
}

interface EnrollmentOption {
  id: string;
  studentId: string;
  programName: string;
  active: boolean;
}

interface DiscountItemOption {
  id: string;
  name: string;
  amount: number;
}

type Target = { kind: 'CLASS'; classId: string } | { kind: 'TUTORING'; enrollmentId: string };

interface ClassPreview {
  sessionsTotal: number;
  deductedSessions: number;
  billedSessions: number;
  unitPrice: number | null;
  amountDue: number;
  detail: BillDetailJson;
  overlapWarning: string | null;
}

interface TutoringPreview {
  monthlyFee: number;
  prorationRatio: number;
  amountDue: number;
  overlapWarning: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_FIELDS: '請完整選擇學生、項目與收費區間',
  MISSING_PRICE: '該班級尚未設定單價，請先於班級管理設定',
  NO_FEE_TIER: '該報名尚未指定收費級距，請先於個別輔導管理設定',
};

export default function StandaloneBillModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentOption[]>([]);
  const [discountItems, setDiscountItems] = useState<DiscountItemOption[]>([]);
  const [selectedDiscountIds, setSelectedDiscountIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [classPreview, setClassPreview] = useState<ClassPreview | null>(null);
  const [tutoringPreview, setTutoringPreview] = useState<TutoringPreview | null>(null);
  const [billedSessionsDraft, setBilledSessionsDraft] = useState('');
  const [amountDueDraft, setAmountDueDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setStudentId('');
    setTarget(null);
    setPeriodStart('');
    setPeriodEnd('');
    setClassPreview(null);
    setTutoringPreview(null);
    setBilledSessionsDraft('');
    setAmountDueDraft('');
    setSelectedDiscountIds([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/students')
      .then((r) => (r.ok ? r.json() : []))
      .then(setStudents);
    fetch('/api/classes')
      .then((r) => (r.ok ? r.json() : []))
      .then(setClasses);
    fetch('/api/tutoring-enrollments')
      .then((r) => (r.ok ? r.json() : []))
      .then(setEnrollments);
    fetch('/api/admin/billing/settings')
      .then((r) => (r.ok ? r.json() : { discountItems: [] }))
      .then((data) => setDiscountItems(data.discountItems ?? []));
  }, [open]);

  function toggleDiscountItem(id: string) {
    setSelectedDiscountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setClassPreview(null);
    setTutoringPreview(null);
  }

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => s.user.name.toLowerCase().includes(q) || (s.studentNumber ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [students, search]);

  const selectedStudent = students.find((s) => s.id === studentId);
  const enrolledClasses = useMemo(() => classes.filter((c) => c.enrollments.some((e) => e.studentId === studentId)), [classes, studentId]);
  const studentEnrollments = useMemo(
    () => enrollments.filter((e) => e.studentId === studentId && e.active),
    [enrollments, studentId]
  );

  function selectStudent(id: string) {
    setStudentId(id);
    setTarget(null);
    setClassPreview(null);
    setTutoringPreview(null);
    setSearch('');
  }

  async function runPreview() {
    if (!target || !periodStart || !periodEnd) return;
    setPreviewing(true);
    setClassPreview(null);
    setTutoringPreview(null);
    try {
      const body =
        target.kind === 'CLASS'
          ? { kind: 'CLASS', preview: true, periodStart, periodEnd, studentId, classId: target.classId, discountItemIds: selectedDiscountIds }
          : { kind: 'TUTORING', preview: true, periodStart, periodEnd, enrollmentId: target.enrollmentId, discountItemIds: selectedDiscountIds };
      const res = await fetch('/api/admin/billing/standalone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '試算失敗，請稍後再試');
        return;
      }
      if (target.kind === 'CLASS') {
        setClassPreview(data);
        setBilledSessionsDraft(String(data.billedSessions));
        setAmountDueDraft(String(data.amountDue));
      } else {
        setTutoringPreview(data);
        setAmountDueDraft(String(data.amountDue));
      }
    } finally {
      setPreviewing(false);
    }
  }

  function onBilledSessionsChange(value: string) {
    setBilledSessionsDraft(value);
    if (!classPreview || classPreview.unitPrice === null) return;
    const n = Number(value);
    if (Number.isFinite(n)) setAmountDueDraft(String(n * classPreview.unitPrice));
  }

  async function submit(notifyNow: boolean) {
    if (!target) return;
    setCreating(true);
    try {
      const amountDue = Number(amountDueDraft);
      const body =
        target.kind === 'CLASS'
          ? {
              kind: 'CLASS',
              preview: false,
              periodStart,
              periodEnd,
              studentId,
              classId: target.classId,
              billedSessions: Number(billedSessionsDraft),
              amountDue,
              notifyNow,
              discountItemIds: selectedDiscountIds,
            }
          : {
              kind: 'TUTORING',
              preview: false,
              periodStart,
              periodEnd,
              enrollmentId: target.enrollmentId,
              amountDue,
              notifyNow,
              discountItemIds: selectedDiscountIds,
            };
      const res = await fetch('/api/admin/billing/standalone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(ERROR_MESSAGES[data.error] ?? '建立帳單失敗，請稍後再試');
        return;
      }
      showToast('已建立帳單');
      setNotifyModalOpen(false);
      onCreated();
    } finally {
      setCreating(false);
    }
  }

  const canPreview = target !== null && periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd;
  const canCreate = (classPreview !== null || tutoringPreview !== null) && amountDueDraft !== '';
  const overlapWarning = classPreview?.overlapWarning ?? tutoringPreview?.overlapWarning ?? null;

  return (
    <>
      <Modal open={open} onClose={onClose} title="單獨開單" maxWidthClassName="max-w-lg">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-ink">選擇學生</p>
            <Input placeholder="搜尋姓名或學號…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {matches.length > 0 && (
              <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
                {matches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectStudent(s.id)}
                    className="border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe"
                  >
                    {s.user.name}
                  </button>
                ))}
              </div>
            )}
            {selectedStudent && (
              <p className="mt-2 text-sm text-ink">
                學生：<span className="font-semibold">{selectedStudent.user.name}</span>
              </p>
            )}
          </div>

          {selectedStudent && (
            <div>
              <p className="mb-1 text-sm font-medium text-ink">選擇項目</p>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-borderSubtle p-2">
                {enrolledClasses.map((c) => (
                  <label key={`class-${c.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-stripe">
                    <input
                      type="radio"
                      name="standalone-target"
                      checked={target?.kind === 'CLASS' && target.classId === c.id}
                      onChange={() => setTarget({ kind: 'CLASS', classId: c.id })}
                    />
                    {c.name}（班級）
                  </label>
                ))}
                {studentEnrollments.map((e) => (
                  <label key={`enr-${e.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-stripe">
                    <input
                      type="radio"
                      name="standalone-target"
                      checked={target?.kind === 'TUTORING' && target.enrollmentId === e.id}
                      onChange={() => setTarget({ kind: 'TUTORING', enrollmentId: e.id })}
                    />
                    {e.programName}（個別輔導）
                  </label>
                ))}
                {enrolledClasses.length === 0 && studentEnrollments.length === 0 && (
                  <p className="px-2 py-1.5 text-sm text-inkMuted">該學生沒有可開單的班級或個別輔導報名</p>
                )}
              </div>
            </div>
          )}

          {target && (
            <>
              <label className="flex flex-col gap-1 text-sm text-ink">
                收費區間起
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                收費區間訖
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </label>
              {discountItems.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium text-ink">優惠項目（僅套用於這張帳單，可複選）</p>
                  <div className="flex flex-col gap-1 rounded-lg border border-borderSubtle p-2">
                    {discountItems.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-stripe">
                        <input
                          type="checkbox"
                          checked={selectedDiscountIds.includes(d.id)}
                          onChange={() => toggleDiscountItem(d.id)}
                        />
                        {d.name}（－{d.amount.toLocaleString('en-US')} 元）
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <Button variant="secondary" disabled={!canPreview} loading={previewing} onClick={runPreview}>
                試算
              </Button>
            </>
          )}

          {overlapWarning && <p className="text-sm font-medium text-pending">{overlapWarning}</p>}

          {classPreview && (
            <div className="flex flex-col gap-2">
              <BillDetailBlock detail={classPreview.detail} />
              {classPreview.unitPrice === null && <p className="text-sm font-semibold text-rejected">請先設定班級單價，金額需手動輸入</p>}
              <label className="flex flex-col gap-1 text-sm text-ink">
                計費堂數
                <Input
                  type="number"
                  min={0}
                  value={billedSessionsDraft}
                  onChange={(e) => onBilledSessionsChange(e.target.value)}
                  className="w-28"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                金額
                <Input type="number" min={0} value={amountDueDraft} onChange={(e) => setAmountDueDraft(e.target.value)} className="w-32" />
              </label>
            </div>
          )}

          {tutoringPreview && (
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border border-borderSubtle bg-cream/40 px-4 py-3 text-sm leading-relaxed">
                <p className="text-ink">
                  月費 {tutoringPreview.monthlyFee.toLocaleString('en-US')} 元
                  {tutoringPreview.prorationRatio < 1 && `（折算 ${Math.round(tutoringPreview.prorationRatio * 100)}%）`}
                </p>
              </div>
              <label className="flex flex-col gap-1 text-sm text-ink">
                金額
                <Input type="number" min={0} value={amountDueDraft} onChange={(e) => setAmountDueDraft(e.target.value)} className="w-32" />
              </label>
            </div>
          )}

          <div className="flex justify-end">
            <Button disabled={!canCreate} onClick={() => setNotifyModalOpen(true)}>
              建立帳單
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={notifyModalOpen} onClose={() => setNotifyModalOpen(false)} title="建立帳單">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink">要立即推播通知家長嗎？</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setNotifyModalOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button variant="secondary" loading={creating} onClick={() => submit(false)}>
              先不通知
            </Button>
            <Button loading={creating} onClick={() => submit(true)}>
              立即通知
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
