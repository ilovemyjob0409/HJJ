'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';

export interface AwardClassOption {
  id: string;
  name: string;
  subject: string;
  students: { id: string; name: string }[];
}

interface ReasonOption {
  id: string;
  label: string;
}

interface RowState {
  reasonId: string;
  amount: string;
}

// 加分主介面：搜尋選班級 → 該班學生表格，每位學生各自填理由＋點數，
// 一次送出。老師端傳入自己任教的班、行政端傳入全部班級。
export default function ClassAwardTable({ classes, onAwarded }: { classes: AwardClassOption[]; onAwarded?: () => void }) {
  const { showToast } = useToast();
  const [reasons, setReasons] = useState<ReasonOption[]>([]);
  const [query, setQuery] = useState('');
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/point-reasons')
      .then((r) => (r.ok ? r.json() : []))
      .then(setReasons);
  }, []);

  const currentClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return classes.filter((c) => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q)).slice(0, 8);
  }, [classes, query]);

  function updateRow(studentId: string, patch: Partial<RowState>) {
    setRows((prev) => {
      const current = prev[studentId] ?? { reasonId: '', amount: '' };
      return { ...prev, [studentId]: { ...current, ...patch } };
    });
  }

  const filledEntries = currentClass
    ? currentClass.students
        .map((s) => ({ student: s, row: rows[s.id] }))
        .filter((e): e is { student: { id: string; name: string }; row: RowState } => {
          if (!e.row) return false;
          return e.row.amount.trim() !== '' || e.row.reasonId !== '';
        })
    : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const incomplete = filledEntries.filter((en) => en.row.reasonId === '' || Number(en.row.amount) < 1);
    if (filledEntries.length === 0) {
      showToast('請先為至少一位學生填點數與理由');
      return;
    }
    if (incomplete.length > 0) {
      showToast(`請補齊 ${incomplete.map((en) => en.student.name).join('、')} 的點數與理由`);
      return;
    }
    setSubmitting(true);
    try {
      for (const entry of filledEntries) {
        const res = await fetch('/api/points/award', {
          method: 'POST',
          body: JSON.stringify({ studentIds: [entry.student.id], amount: Number(entry.row.amount), reasonId: entry.row.reasonId }),
        });
        if (!res.ok) {
          const data = await res.json();
          showToast(
            data.error === 'INVALID_AMOUNT' ? `點數需為 1–10 的整數（${entry.student.name}）` : '送出失敗，請稍後再試'
          );
          return;
        }
      }
      showToast(`已為 ${filledEntries.length} 位學生加分`);
      setRows({});
      onAwarded?.();
    } finally {
      setSubmitting(false);
    }
  }

  const columns: Column<{ id: string; name: string }>[] = [
    { header: '學生', render: (s) => <span className="block text-left">{s.name}</span> },
    {
      header: '理由',
      render: (s) => (
        <Select
          value={rows[s.id]?.reasonId ?? ''}
          onChange={(e) => updateRow(s.id, { reasonId: e.target.value })}
          className="min-w-[10rem]"
        >
          <option value="">－</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: '點數',
      render: (s) => (
        <Input
          type="number"
          min={1}
          max={10}
          placeholder="－"
          value={rows[s.id]?.amount ?? ''}
          onChange={(e) => updateRow(s.id, { amount: e.target.value })}
          className="w-20"
        />
      ),
    },
  ];

  return (
    <Card>
      <p className="mb-1 text-sm font-medium text-ink">選擇班級</p>
      <Input placeholder="搜尋班級名稱或科目…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {matches.length > 0 && (
        <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setClassId(c.id);
                setQuery('');
                setRows({});
              }}
              className="flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe"
            >
              <span className="text-ink">{c.name}</span>
              <span className="text-xs text-inkMuted">
                {c.subject}・{c.students.length} 人
              </span>
            </button>
          ))}
        </div>
      )}

      {currentClass && (
        <form onSubmit={handleSubmit} className="mt-4">
          <p className="mb-2 text-sm text-ink">
            <span className="font-semibold">{currentClass.name}</span>
            <span className="ml-2 text-inkMuted">只送出有填點數與理由的學生</span>
          </p>
          {currentClass.students.length === 0 ? (
            <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">
              此班級尚無學生
            </p>
          ) : (
            <>
              <DataTable columns={columns} rows={currentClass.students} keyField={(s) => s.id} />
              {reasons.length === 0 && (
                <p className="mt-2 text-xs text-inkMuted">尚無加分理由選項，請先請行政人員於「集點」管理頁建立。</p>
              )}
              <Button type="submit" loading={submitting} disabled={reasons.length === 0} className="mt-3">
                送出加分（{filledEntries.length} 位）
              </Button>
            </>
          )}
        </form>
      )}
    </Card>
  );
}
