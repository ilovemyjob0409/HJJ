'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface RewardRow {
  id: string;
  name: string;
  pointsCost: number;
  sortOrder: number;
}

export default function RewardItemsManager({ onChanged }: { onChanged?: () => void }) {
  const { showToast } = useToast();
  const [items, setItems] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', pointsCost: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<RewardRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', pointsCost: '' });

  async function load() {
    try {
      const res = await fetch('/api/reward-items');
      if (!res.ok) {
        showToast('載入失敗，請稍後再試');
        return;
      }
      setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function notifyChanged() {
    load();
    onChanged?.();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/reward-items', {
        method: 'POST',
        body: JSON.stringify({ name: form.name, pointsCost: Number(form.pointsCost) }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'INVALID_COST' ? '所需點數需為正整數' : '新增失敗，請稍後再試');
        return;
      }
      setForm({ name: '', pointsCost: '' });
      setShowAddForm(false);
      showToast('已新增獎品');
      notifyChanged();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(item: RewardRow) {
    setEditing(item);
    setEditForm({ name: item.name, pointsCost: String(item.pointsCost) });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reward-items/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editForm.name, pointsCost: Number(editForm.pointsCost) }),
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'INVALID_COST' ? '所需點數需為正整數' : '儲存失敗，請稍後再試');
        return;
      }
      setEditing(null);
      showToast('已儲存');
      notifyChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`確定要刪除獎品「${editing.name}」嗎？不影響已兌換的歷史紀錄。`)) return;
    await fetch(`/api/reward-items/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    showToast('已刪除');
    notifyChanged();
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/reward-items/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    if (!res.ok) {
      showToast('排序失敗，請稍後再試');
      return;
    }
    setItems(await res.json());
    onChanged?.();
  }

  const columns: Column<RewardRow>[] = [
    { header: '獎品', render: (item) => <span className="block text-left">{item.name}</span> },
    { header: '所需點數', render: (item) => item.pointsCost },
    {
      header: '排序',
      render: (item) => {
        const index = items.findIndex((i) => i.id === item.id);
        return (
          <div className="flex items-center justify-center gap-2">
            {index > 0 && (
              <button
                type="button"
                aria-label="上移"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMove(item.id, 'up');
                }}
                className="text-inkMuted hover:text-ink"
              >
                ↑
              </button>
            )}
            {index < items.length - 1 && (
              <button
                type="button"
                aria-label="下移"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMove(item.id, 'down');
                }}
                className="text-inkMuted hover:text-ink"
              >
                ↓
              </button>
            )}
          </div>
        );
      },
    },
    {
      header: '操作',
      render: (item) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(item)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <>
      <h2 className="mb-2 font-bold text-ink">獎品目錄維護</h2>
      <div className="mb-4">{!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增獎品</Button>}</div>

      {showAddForm && (
        <Card className="mb-4 max-w-xl">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input placeholder="獎品名稱" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="flex-1" />
            <Input
              type="number"
              placeholder="所需點數"
              value={form.pointsCost}
              onChange={(e) => setForm({ ...form, pointsCost: e.target.value })}
              required
              className="w-28"
            />
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card className="mb-6">
        <DataTable
          columns={columns}
          rows={items}
          keyField={(item) => item.id}
          loading={loading}
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯獎品">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Input placeholder="獎品名稱" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input
            type="number"
            placeholder="所需點數"
            value={editForm.pointsCost}
            onChange={(e) => setEditForm({ ...editForm, pointsCost: e.target.value })}
            required
          />
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此獎品
        </button>
      </Modal>
    </>
  );
}
