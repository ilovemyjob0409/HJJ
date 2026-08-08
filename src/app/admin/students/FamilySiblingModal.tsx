'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';

interface StudentOption {
  id: string;
  familyGroupId: string | null;
  user: { name: string };
}

export default function FamilySiblingModal({
  student,
  allStudents,
  onClose,
  onSaved,
}: {
  student: StudentOption;
  allStudents: StudentOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        allStudents
          .filter((s) => s.id !== student.id && s.familyGroupId !== null && s.familyGroupId === student.familyGroupId)
          .map((s) => s.id)
      )
  );
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/students/${student.id}/family`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siblingIds: Array.from(selected) }),
      });
      if (!res.ok) {
        showToast('設定失敗，請稍後再試');
        return;
      }
      showToast('已更新手足設定');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const options = allStudents.filter((s) => {
    if (s.id === student.id) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return s.user.name.toLowerCase().includes(q);
  });

  return (
    <Modal open onClose={onClose} title={`設定手足：${student.user.name}`} maxWidthClassName="max-w-md">
      <Input placeholder="搜尋姓名" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2" />
      <div className="max-h-72 overflow-y-auto">
        <DataTable
          columns={[
            {
              header: '',
              render: (s) => <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />,
            },
            { header: '姓名', render: (s) => s.user.name },
          ]}
          rows={options}
          keyField={(s) => s.id}
          emptyText="找不到符合的學生"
        />
      </div>
      <Button className="mt-3 w-full" loading={saving} onClick={save}>
        儲存
      </Button>
    </Modal>
  );
}
