'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

interface ClassOption {
  id: string;
  name: string;
  enrollments: { student: { id: string; user: { name: string } } }[];
}

interface ReasonOption {
  id: string;
  label: string;
}

export default function AwardPointsForm({ classes }: { classes: ClassOption[] }) {
  const { showToast } = useToast();
  const [reasons, setReasons] = useState<ReasonOption[]>([]);
  const [classId, setClassId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amount, setAmount] = useState('1');
  const [reasonId, setReasonId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/point-reasons')
      .then((r) => (r.ok ? r.json() : []))
      .then(setReasons);
  }, []);

  const currentClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function toggle(studentId: string) {
    setSelected((prev) => ({ ...prev, [studentId]: !prev[studentId] }));
  }

  function selectAll() {
    if (!currentClass) return;
    setSelected(Object.fromEntries(currentClass.enrollments.map((e) => [e.student.id, true])));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/points/award', {
        method: 'POST',
        body: JSON.stringify({ studentIds: selectedIds, amount: Number(amount), reasonId }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'INVALID_AMOUNT' ? '點數需為 1–10 的整數' : '送出失敗，請稍後再試');
        return;
      }
      showToast(`已給 ${selectedIds.length} 位學生各 ${Number(amount)} 點`);
      setSelected({});
    } finally {
      setSubmitting(false);
    }
  }

  if (classes.length === 0) {
    return (
      <Card>
        <p className="text-sm text-inkMuted">您目前沒有任教班級</p>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setSelected({});
          }}
          required
        >
          <option value="">選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{c.enrollments.length} 人）
            </option>
          ))}
        </Select>

        {currentClass && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">選擇學生（已選 {selectedIds.length} 人）</p>
              <div className="flex gap-3 text-xs">
                <button type="button" className="text-brandDark hover:underline" onClick={selectAll}>
                  全選
                </button>
                <button type="button" className="text-inkMuted hover:underline" onClick={() => setSelected({})}>
                  清除
                </button>
              </div>
            </div>
            {currentClass.enrollments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">
                此班級尚無學生
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {currentClass.enrollments.map((e) => (
                  <label
                    key={e.student.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-borderSubtle px-2 py-1.5 text-sm text-ink hover:bg-stripe"
                  >
                    <input type="checkbox" checked={!!selected[e.student.id]} onChange={() => toggle(e.student.id)} />
                    {e.student.user.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            max={10}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24"
            required
          />
          <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)} required className="flex-1">
            <option value="">選擇理由</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        {reasons.length === 0 && <p className="text-xs text-inkMuted">尚無給點理由選項，請先請行政人員於「集點」管理頁建立。</p>}

        <Button type="submit" loading={submitting} disabled={selectedIds.length === 0 || reasons.length === 0}>
          送出給點
        </Button>
      </form>
    </Card>
  );
}
