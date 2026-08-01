'use client';

import { useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import AwardRowsForm from '@/components/AwardRowsForm';

export interface AwardClassOption {
  id: string;
  name: string;
  subject: string;
  students: { id: string; name: string }[];
}

// 加分主介面：搜尋選班級 → 該班學生的加分列表（AwardRowsForm）。
// 老師端傳入自己任教的班、行政端傳入全部班級。
export default function ClassAwardTable({ classes, onAwarded }: { classes: AwardClassOption[]; onAwarded?: () => void }) {
  const [query, setQuery] = useState('');
  const [classId, setClassId] = useState('');

  const currentClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return classes.filter((c) => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q)).slice(0, 8);
  }, [classes, query]);

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
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-ink">{currentClass.name}</p>
          {currentClass.students.length === 0 ? (
            <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">
              此班級尚無學生
            </p>
          ) : (
            // key: 換班級時重置各列輸入
            <AwardRowsForm key={currentClass.id} students={currentClass.students} onAwarded={onAwarded} />
          )}
        </div>
      )}
    </Card>
  );
}
