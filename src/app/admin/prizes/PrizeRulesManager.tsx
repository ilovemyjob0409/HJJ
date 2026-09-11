'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Textarea from '@/components/ui/Textarea';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';

interface RuleRow {
  id: string;
  content: string;
  sortOrder: number;
}

export default function PrizeRulesManager() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [editContent, setEditContent] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/prize-rules');
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
      const res = await fetch('/api/prize-rules', { method: 'POST', body: JSON.stringify({ content }) });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setContent('');
      setShowAddForm(false);
      showToast('已新增規則');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(item: RuleRow) {
    setEditing(item);
    setEditContent(item.content);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/prize-rules/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ content: editContent }) });
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
    if (!(await confirm('確定要刪除這條兌換規則嗎？此操作無法復原。', { danger: true }))) return;
    await fetch(`/api/prize-rules/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    showToast('已刪除');
    load();
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/prize-rules/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    if (!res.ok) {
      showToast('排序失敗，請稍後再試');
      return;
    }
    setItems(await res.json());
  }

  const columns: Column<RuleRow>[] = [
    {
      header: '內容',
      render: (item) => (
        <span className="block max-w-[28rem] truncate text-left" title={item.content}>
          {item.content}
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
        <Button variant="link" onClick={() => openEdit(item)}>
          編輯
        </Button>
      ),
    },
  ];

  return (
    <Card className="mb-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-bold text-ink">兌換規則</h2>
        {!showAddForm && (
          <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => setShowAddForm(true)}>
            ＋ 新增規則
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-inkMuted">這裡的內容會依序顯示在學生「集點＆獎品」頁的「兌換規則」區塊；沒有任何內容時該區塊不會顯示。</p>

      {showAddForm && (
        <div className="mb-4 max-w-xl rounded-xl border border-borderSubtle p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增規則</h2>
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Textarea placeholder="規則內容" value={content} onChange={(e) => setContent(e.target.value)} rows={3} required />
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </div>
      )}

      <DataTable
          columns={columns}
          rows={items}
          keyField={(item) => item.id}
          loading={loading}
          emptyText="目前沒有兌換規則"
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯規則">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Textarea placeholder="規則內容" value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3} required />
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除此規則
        </Button>
      </Modal>
      {ConfirmDialog}
    </Card>
  );
}
