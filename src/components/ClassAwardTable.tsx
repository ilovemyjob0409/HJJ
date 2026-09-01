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

// 加分主介面：老師帶的班常駐列出，搜尋框只做過濾；點班級 → 該班學生的
// 加分列表（AwardRowsForm）。目前僅老師端使用（傳入自己任教的班與個輔方案）。
export default function ClassAwardTable({ classes, onAwarded }: { classes: AwardClassOption[]; onAwarded?: () => void }) {
  const [query, setQuery] = useState('');
  const [classId, setClassId] = useState('');

  const currentClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q));
  }, [classes, query]);

  return (
    <Card>
      <p className="mb-1 text-sm font-medium text-ink">選擇班級</p>
      {classes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">
          目前沒有可加分的班級
        </p>
      ) : (
        <>
          <Input placeholder="搜尋班級名稱或科目…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
            {matches.length === 0 ? (
              <p className="p-2 text-center text-xs text-inkMuted">找不到符合的班級</p>
            ) : (
              matches.map((c) => {
                const selected = c.id === classId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setClassId(c.id);
                      setQuery('');
                    }}
                    className={`flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm transition-colors last:border-b-0 ${
                      selected ? 'bg-stripe' : 'hover:bg-stripe'
                    }`}
                  >
                    <span className={selected ? 'font-semibold text-brandDark' : 'text-ink'}>{c.name}</span>
                    <span className="text-xs text-inkMuted">
                      {c.subject}・{c.students.length} 人
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
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
