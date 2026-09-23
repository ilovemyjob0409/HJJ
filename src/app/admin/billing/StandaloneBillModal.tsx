'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
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

type Target =
  | { kind: 'CLASS'; classId: string }
  | { kind: 'TUTORING'; enrollmentId: string }
  | { kind: 'GO_HALL'; item: 'TICKETS' | 'SEASON_PASS' };

interface ClassPreview {
  sessionsTotal: number;
  deductedSessions: number;
  billedSessions: number;
  unitPrice: number;
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

interface GoHallPreview {
  grossAmount: number;
  amountDue: number;
  formula: string;
  netFormula?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_FIELDS: '請完整選擇學生、項目與收費區間',
  NO_FEE_TIER: '該報名尚未指定收費級距，請先於個別輔導管理設定',
  INVALID_INPUT: '請確認堂數、單價與價格為有效數字（堂數至少 1）',
  INVALID_RANGE: '季票結束日不能早於開始日',
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
  // 優惠列（試算前自行輸入）：名稱與金額都可編輯；可從預設項目帶入或加自訂列。
  const [discountRows, setDiscountRows] = useState<{ name: string; amount: string }[]>([]);
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
  const [goHallPreview, setGoHallPreview] = useState<GoHallPreview | null>(null);
  const [goHallSessions, setGoHallSessions] = useState('');
  const [goHallUnitPrice, setGoHallUnitPrice] = useState('');
  const [goHallPrice, setGoHallPrice] = useState('');
  const [goHallDefaults, setGoHallDefaults] = useState({ ticket: 0, pass: 0 });

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
    setDiscountRows([]);
    setGoHallPreview(null);
    setGoHallSessions('');
    setGoHallUnitPrice('');
    setGoHallPrice('');
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
      .then((data) => {
        setDiscountItems(data.discountItems ?? []);
        setGoHallDefaults({ ticket: data.goHallTicketPrice ?? 0, pass: data.goHallSeasonPassPrice ?? 0 });
      });
  }, [open]);

  // 任何優惠列變動都會讓既有試算失效（同原本勾選預設項目的行為）。
  function mutateDiscountRows(mutate: (rows: { name: string; amount: string }[]) => { name: string; amount: string }[]) {
    setDiscountRows(mutate);
    setClassPreview(null);
    setTutoringPreview(null);
    setGoHallPreview(null);
  }

  function addPresetDiscount(id: string) {
    const item = discountItems.find((d) => d.id === id);
    if (!item) return;
    mutateDiscountRows((rows) => [...rows, { name: item.name, amount: String(item.amount) }]);
  }

  // 送 API 前的優惠列整理：全空列自動忽略，半填列擋下請行政補完。
  function collectDiscounts(): { name: string; amount: number }[] | null {
    const filled = discountRows.filter((r) => r.name.trim() !== '' || r.amount.trim() !== '');
    const discounts: { name: string; amount: number }[] = [];
    for (const r of filled) {
      const amount = Number(r.amount);
      if (r.name.trim() === '' || !Number.isInteger(amount) || amount <= 0) return null;
      discounts.push({ name: r.name.trim(), amount });
    }
    return discounts;
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
    setGoHallPreview(null);
    setSearch('');
  }

  function selectGoHall(item: 'TICKETS' | 'SEASON_PASS') {
    setTarget({ kind: 'GO_HALL', item });
    setClassPreview(null);
    setTutoringPreview(null);
    setGoHallPreview(null);
    if (item === 'TICKETS') setGoHallUnitPrice(goHallDefaults.ticket > 0 ? String(goHallDefaults.ticket) : '');
    else setGoHallPrice(goHallDefaults.pass > 0 ? String(goHallDefaults.pass) : '');
  }

  function goHallBody(preview: boolean, discounts: { name: string; amount: number }[]) {
    if (target?.kind !== 'GO_HALL') return null;
    return target.item === 'TICKETS'
      ? { kind: 'GO_HALL', preview, studentId, item: 'TICKETS', sessions: Number(goHallSessions), unitPrice: Number(goHallUnitPrice), discounts }
      : { kind: 'GO_HALL', preview, studentId, item: 'SEASON_PASS', startDate: periodStart, endDate: periodEnd, price: Number(goHallPrice), discounts };
  }

  async function runPreview() {
    if (!target) return;
    if (target.kind !== 'GO_HALL' && (!periodStart || !periodEnd)) return;
    const discounts = collectDiscounts();
    if (discounts === null) {
      showToast('請填寫完整的優惠項目資訊');
      return;
    }
    setPreviewing(true);
    setClassPreview(null);
    setTutoringPreview(null);
    setGoHallPreview(null);
    try {
      const body =
        target.kind === 'GO_HALL'
          ? goHallBody(true, discounts)
          : target.kind === 'CLASS'
            ? { kind: 'CLASS', preview: true, periodStart, periodEnd, studentId, classId: target.classId, discounts }
            : { kind: 'TUTORING', preview: true, periodStart, periodEnd, enrollmentId: target.enrollmentId, discounts };
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
      if (target.kind === 'GO_HALL') {
        setGoHallPreview(data);
        setAmountDueDraft(String(data.amountDue));
      } else if (target.kind === 'CLASS') {
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
    if (!classPreview) return;
    const n = Number(value);
    if (Number.isFinite(n)) setAmountDueDraft(String(n * classPreview.unitPrice));
  }

  async function submit(notifyNow: boolean) {
    if (!target) return;
    // 建立時優惠列一定跟試算時一致（改動列會清空試算、按鈕就不可按），這裡再守一次以防萬一。
    const discounts = collectDiscounts();
    if (discounts === null) {
      showToast('請填寫完整的優惠項目資訊');
      return;
    }
    setCreating(true);
    try {
      const amountDue = Number(amountDueDraft);
      const body =
        target.kind === 'GO_HALL'
          ? { ...goHallBody(false, discounts)!, amountDue, notifyNow }
          : target.kind === 'CLASS'
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
                discounts,
              }
            : {
                kind: 'TUTORING',
                preview: false,
                periodStart,
                periodEnd,
                enrollmentId: target.enrollmentId,
                amountDue,
                notifyNow,
                discounts,
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

  const canPreview =
    target !== null &&
    (target.kind === 'GO_HALL' && target.item === 'TICKETS'
      ? Number(goHallSessions) >= 1 && goHallUnitPrice !== ''
      : periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd &&
        (target.kind !== 'GO_HALL' || goHallPrice !== ''));
  const canCreate = (classPreview !== null || tutoringPreview !== null || goHallPreview !== null) && amountDueDraft !== '';
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
                      onChange={() => {
                        setTarget({ kind: 'CLASS', classId: c.id });
                        setClassPreview(null);
                        setTutoringPreview(null);
                        setGoHallPreview(null);
                      }}
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
                      onChange={() => {
                        setTarget({ kind: 'TUTORING', enrollmentId: e.id });
                        setClassPreview(null);
                        setTutoringPreview(null);
                        setGoHallPreview(null);
                      }}
                    />
                    {e.programName}（個別輔導）
                  </label>
                ))}
                {(['TICKETS', 'SEASON_PASS'] as const).map((item) => (
                  <label key={`gohall-${item}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-stripe">
                    <input
                      type="radio"
                      name="standalone-target"
                      checked={target?.kind === 'GO_HALL' && target.item === item}
                      onChange={() => selectGoHall(item)}
                    />
                    {item === 'TICKETS' ? '弈廳堂票' : '弈廳季票'}（弈廳）
                  </label>
                ))}
              </div>
            </div>
          )}

          {target && (
            <>
              {target.kind === 'GO_HALL' && target.item === 'TICKETS' && (
                <div className="flex flex-wrap gap-3">
                  <div className="flex flex-col gap-1 text-sm text-ink">
                    <span>堂數</span>
                    <Input
                      type="number"
                      min={1}
                      value={goHallSessions}
                      onChange={(e) => {
                        setGoHallSessions(e.target.value);
                        setGoHallPreview(null);
                      }}
                      className="w-28"
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-ink">
                    <span>單價（元／堂）</span>
                    <Input
                      type="number"
                      min={0}
                      value={goHallUnitPrice}
                      onChange={(e) => {
                        setGoHallUnitPrice(e.target.value);
                        setGoHallPreview(null);
                      }}
                      className="w-28"
                    />
                  </div>
                </div>
              )}
              {!(target.kind === 'GO_HALL' && target.item === 'TICKETS') && (
                <>
                  <label className="flex flex-col gap-1 text-sm text-ink">
                    {target.kind === 'GO_HALL' ? '季票起' : '收費區間起'}
                    <Input
                      type="date"
                      value={periodStart}
                      onChange={(e) => {
                        setPeriodStart(e.target.value);
                        setGoHallPreview(null);
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-ink">
                    {target.kind === 'GO_HALL' ? '季票訖' : '收費區間訖'}
                    <Input
                      type="date"
                      value={periodEnd}
                      onChange={(e) => {
                        setPeriodEnd(e.target.value);
                        setGoHallPreview(null);
                      }}
                    />
                  </label>
                </>
              )}
              {target.kind === 'GO_HALL' && target.item === 'SEASON_PASS' && (
                <div className="flex flex-col gap-1 text-sm text-ink">
                  <span>季票價格（元）</span>
                  <Input
                    type="number"
                    min={0}
                    value={goHallPrice}
                    onChange={(e) => {
                      setGoHallPrice(e.target.value);
                      setGoHallPreview(null);
                    }}
                    className="w-32"
                  />
                </div>
              )}
              <div>
                <p className="mb-1 text-sm font-medium text-ink">優惠項目（僅套用於這張帳單，名稱與金額可自行輸入）</p>
                <div className="flex flex-col gap-2 rounded-lg border border-borderSubtle p-2">
                  {discountRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        placeholder="優惠名稱"
                        value={row.name}
                        onChange={(e) => mutateDiscountRows((rows) => rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))}
                        className="min-w-0 flex-1"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="金額"
                        value={row.amount}
                        onChange={(e) => mutateDiscountRows((rows) => rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
                        className="w-24 shrink-0"
                      />
                      <button
                        type="button"
                        aria-label="移除優惠項目"
                        onClick={() => mutateDiscountRows((rows) => rows.filter((_, i) => i !== index))}
                        className="shrink-0 rounded p-1 text-inkMuted transition-colors hover:text-rejected"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    {discountItems.length > 0 && (
                      <Select value="" onChange={(e) => addPresetDiscount(e.target.value)} className="min-w-0 flex-1">
                        <option value="" disabled>
                          從預設項目帶入…
                        </option>
                        {discountItems.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}（－{d.amount.toLocaleString('en-US')} 元）
                          </option>
                        ))}
                      </Select>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => mutateDiscountRows((rows) => [...rows, { name: '', amount: '' }])}
                      className="shrink-0"
                    >
                      ＋ 自訂優惠
                    </Button>
                  </div>
                </div>
              </div>
              <Button variant="secondary" disabled={!canPreview} loading={previewing} onClick={runPreview}>
                試算
              </Button>
            </>
          )}

          {overlapWarning && <p className="text-sm font-medium text-pending">{overlapWarning}</p>}

          {classPreview && (
            <div className="flex flex-col gap-2">
              <BillDetailBlock detail={classPreview.detail} />
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

          {goHallPreview && (
            <div className="flex flex-col gap-2">
              <BillDetailBlock
                detail={{ sessionDates: [], deduction: null, formula: goHallPreview.formula, netFormula: goHallPreview.netFormula, discounts: collectDiscounts() ?? [] }}
              />
              <label className="flex flex-col gap-1 text-sm text-ink">
                金額
                <Input type="number" min={0} value={amountDueDraft} onChange={(e) => setAmountDueDraft(e.target.value)} className="w-32" />
              </label>
              <p className="text-xs text-inkMuted">
                {target?.kind === 'GO_HALL' && target.item === 'TICKETS' ? '建立後堂票會直接加進學生的弈廳帳本' : '建立後季票會直接生效'}
              </p>
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
