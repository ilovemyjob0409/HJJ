'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';

export interface AwardStudent {
  id: string;
  name: string;
}

interface ReasonOption {
  id: string;
  label: string;
}

interface RowState {
  reasonId: string;
  amount: string;
}

const EMPTY_ROW: RowState = { reasonId: '', amount: '' };

// 加分畫面共用核心：每位學生一列（理由＋點數），每位學生可「＋新增一列」
// 一次給多筆；只送出有填的列。班級加分表與批量加分視窗共用。
export default function AwardRowsForm({ students, onAwarded }: { students: AwardStudent[]; onAwarded?: () => void }) {
  const { showToast } = useToast();
  const [reasons, setReasons] = useState<ReasonOption[]>([]);
  const [rowsByStudent, setRowsByStudent] = useState<Record<string, RowState[]>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/point-reasons')
      .then((r) => (r.ok ? r.json() : []))
      .then(setReasons);
  }, []);

  function getRows(studentId: string): RowState[] {
    return rowsByStudent[studentId] ?? [EMPTY_ROW];
  }

  function updateRow(studentId: string, index: number, patch: Partial<RowState>) {
    setRowsByStudent((prev) => {
      const current = prev[studentId] ?? [EMPTY_ROW];
      return { ...prev, [studentId]: current.map((row, i) => (i === index ? { ...row, ...patch } : row)) };
    });
  }

  function addRow(studentId: string) {
    setRowsByStudent((prev) => ({ ...prev, [studentId]: [...(prev[studentId] ?? [EMPTY_ROW]), EMPTY_ROW] }));
  }

  function removeRow(studentId: string, index: number) {
    setRowsByStudent((prev) => {
      const current = prev[studentId] ?? [EMPTY_ROW];
      const next = current.filter((_, i) => i !== index);
      return { ...prev, [studentId]: next.length > 0 ? next : [EMPTY_ROW] };
    });
  }

  // 有動過的列（任一欄有值）才會送出；兩欄都空的列一律忽略。
  const filledEntries = students.flatMap((s) =>
    getRows(s.id)
      .filter((row) => row.amount.trim() !== '' || row.reasonId !== '')
      .map((row) => ({ student: s, row }))
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (filledEntries.length === 0) {
      showToast('請先為至少一位學生填點數與理由');
      return;
    }
    const incomplete = filledEntries.filter((en) => en.row.reasonId === '' || Number(en.row.amount) < 1);
    if (incomplete.length > 0) {
      const names = Array.from(new Set(incomplete.map((en) => en.student.name)));
      showToast(`請補齊 ${names.join('、')} 的點數與理由`);
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
      const studentCount = new Set(filledEntries.map((en) => en.student.id)).size;
      showToast(`已為 ${studentCount} 位學生加分（共 ${filledEntries.length} 筆）`);
      setRowsByStudent({});
      onAwarded?.();
    } finally {
      setSubmitting(false);
    }
  }

  const columns: Column<AwardStudent>[] = [
    { header: '學生', render: (s) => <span className="block text-left align-top">{s.name}</span>, sortValue: (s) => s.name },
    {
      header: '理由＋點數',
      render: (s) => (
        <div className="flex flex-col items-start gap-1.5">
          {getRows(s.id).map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={row.reasonId}
                onChange={(e) => updateRow(s.id, index, { reasonId: e.target.value })}
                className="min-w-[10rem]"
              >
                <option value="">－</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={1}
                max={10}
                placeholder="－"
                value={row.amount}
                onChange={(e) => updateRow(s.id, index, { amount: e.target.value })}
                className="w-20"
              />
              {getRows(s.id).length > 1 && (
                <button
                  type="button"
                  aria-label={`移除${s.name}的此列`}
                  onClick={() => removeRow(s.id, index)}
                  className="text-inkMuted hover:text-rejected"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <Button variant="link" onClick={() => addRow(s.id)} className="text-xs">
            ＋ 新增一列
          </Button>
        </div>
      ),
    },
  ];

  if (students.length === 0) {
    return <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">尚未選擇學生</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="mb-2 text-sm text-inkMuted">只送出有填點數與理由的列</p>
      <DataTable columns={columns} rows={students} keyField={(s) => s.id} />
      {reasons.length === 0 && <p className="mt-2 text-xs text-inkMuted">尚無加分理由選項，請先請行政人員於「集點」管理頁建立。</p>}
      <Button type="submit" loading={submitting} disabled={reasons.length === 0} className="mt-3">
        送出加分（{filledEntries.length} 筆）
      </Button>
    </form>
  );
}
