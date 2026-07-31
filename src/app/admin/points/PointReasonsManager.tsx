'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface ReasonRow {
  id: string;
  label: string;
  sortOrder: number;
}

export default function PointReasonsManager() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ReasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<ReasonRow | null>(null);
  const [editLabel, setEditLabel] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/point-reasons');
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/point-reasons', { method: 'POST', body: JSON.stringify({ label }) });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setLabel('');
      setShowAddForm(false);
      showToast('已新增理由');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(item: ReasonRow) {
    setEditing(item);
    setEditLabel(item.label);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/point-reasons/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ label: editLabel }) });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
      setEditing(null);
      showToast('已儲存');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`確定要刪除理由「${editing.label}」嗎？不影響已加分的歷史紀錄。`)) return;
    await fetch(`/api/point-reasons/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    showToast('已刪除');
    load();
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/point-reasons/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    if (!res.ok) {
      showToast('排序失敗，請稍後再試');
      return;
    }
    setItems(await res.json());
  }

  const columns: Column<ReasonRow>[] = [
    { header: '理由', render: (item) => <span className="block text-left">{item.label}</span> },
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
      <h2 className="mb-2 font-bold text-ink">加分理由維護</h2>
      <div className="mb-4">{!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增理由</Button>}</div>

      {showAddForm && (
        <Card className="mb-4 max-w-xl">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input placeholder="理由（例如：課堂表現優良）" value={label} onChange={(e) => setLabel(e.target.value)} required className="flex-1" />
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯理由">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} required />
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此理由
        </button>
      </Modal>
    </>
  );
}
