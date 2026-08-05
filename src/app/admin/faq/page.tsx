'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';

interface FaqItemRow {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export default function AdminFaqPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState<FaqItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ question: '', answer: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<FaqItemRow | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '' });

  async function load() {
    try {
      const res = await fetch('/api/faq');
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
      const res = await fetch('/api/faq', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setForm({ question: '', answer: '' });
      setShowAddForm(false);
      showToast('已新增問題');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(item: FaqItemRow) {
    setEditing(item);
    setEditForm({ question: item.question, answer: item.answer });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/faq/${editing.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
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
    if (!(await confirm(`確定要刪除「${editing.question}」嗎？此操作無法復原。`, { danger: true }))) return;
    await fetch(`/api/faq/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    showToast('已刪除');
    load();
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/faq/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    if (!res.ok) {
      showToast('排序失敗，請稍後再試');
      return;
    }
    setItems(await res.json());
  }

  const columns: Column<FaqItemRow>[] = [
    {
      header: '問題',
      render: (item) => (
        <span className="block max-w-[28rem] truncate text-left" title={item.question}>
          {item.question}
        </span>
      ),
    },
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
      <h1 className="mb-4 text-xl font-bold text-ink">常見問題管理</h1>
      <div className="mb-6">{!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增問題</Button>}</div>

      {showAddForm && (
        <Card className="mb-6 max-w-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增問題</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="問題" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required />
            <textarea
              placeholder="答案"
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
              rows={4}
              required
            />
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={items}
          keyField={(item) => item.id}
          loading={loading}
          emptyText="目前沒有常見問題"
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯問題">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Input
            placeholder="問題"
            value={editForm.question}
            onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
            required
          />
          <textarea
            placeholder="答案"
            value={editForm.answer}
            onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
            className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
            rows={4}
            required
          />
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此問題
        </button>
      </Modal>
      {ConfirmDialog}
    </>
  );
}
