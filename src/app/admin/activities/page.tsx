'use client';

import { useEffect, useRef, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import ActivityAlbum from '@/components/ActivityAlbum';
import ImageCropModal from '@/components/ImageCropModal';
import { compressImage } from '@/lib/imageCompression';
import { uploadCompressedImage } from '@/lib/uploadActivityImage';

interface StagedPhoto {
  blob: Blob;
  previewUrl: string;
}

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface CategoryOption {
  id: string;
  name: string;
}

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  coverUrl: string | null;
  title: string;
  description: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
  registrations: RosterEntry[];
  _count: { registrations: number };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function AdminActivitiesPage() {
  const { showToast } = useToast();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    categoryId: '',
    location: '',
    startDate: '',
    endDate: '',
    capacity: '20',
  });
  const [formTeacherIds, setFormTeacherIds] = useState<string[]>([]);
  const [teacherPickerOpen, setTeacherPickerOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [viewing, setViewing] = useState<ActivityRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const stagedFileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [activitiesRes, teachersRes, categoriesRes] = await Promise.all([
        fetch('/api/activities'),
        fetch('/api/teachers'),
        fetch('/api/activity-categories'),
      ]);
      setActivities(await activitiesRes.json());
      setTeachers(await teachersRes.json());
      setCategories(await categoriesRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleFormTeacher(teacherId: string) {
    setFormTeacherIds((prev) => (prev.includes(teacherId) ? prev.filter((id) => id !== teacherId) : [...prev, teacherId]));
  }

  function clearStagedPhotos() {
    setStagedPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }

  function closeAddForm() {
    setShowAddForm(false);
    clearStagedPhotos();
  }

  function handleStagePhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setCropQueue(Array.from(files));
    if (stagedFileInputRef.current) stagedFileInputRef.current.value = '';
  }

  async function handleCroppedPhotos(blobs: Blob[]) {
    setCropQueue([]);
    for (const blob of blobs) {
      try {
        const compressed = await compressImage(blob);
        setStagedPhotos((prev) => [...prev, { blob: compressed, previewUrl: URL.createObjectURL(compressed) }]);
      } catch {
        showToast('有照片壓縮失敗');
      }
    }
  }

  function removeStagedPhoto(index: number) {
    setStagedPhotos((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setFormError('');
      if (formTeacherIds.length === 0) {
        setFormError('請至少選擇一位帶領老師');
        return;
      }
      const res = await fetch('/api/activities', {
        method: 'POST',
        body: JSON.stringify({ ...form, capacity: Number(form.capacity), teacherIds: formTeacherIds }),
      });
      if (!res.ok) {
        setFormError('新增活動失敗，請稍後再試');
        return;
      }
      const created = await res.json();
      let failedPhotos = 0;
      for (const photo of stagedPhotos) {
        const ok = await uploadCompressedImage(created.id, photo.blob);
        if (!ok) failedPhotos += 1;
      }
      clearStagedPhotos();
      setForm({ title: '', description: '', categoryId: '', location: '', startDate: '', endDate: '', capacity: '20' });
      setFormTeacherIds([]);
      setTeacherPickerOpen(false);
      setShowAddForm(false);
      showToast(failedPhotos === 0 ? '已新增活動' : `已新增活動，但有 ${failedPhotos} 張照片上傳失敗`);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    setCategorySubmitting(true);
    try {
      const res = await fetch('/api/activity-categories', { method: 'POST', body: JSON.stringify({ name: newCategoryName }) });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'CATEGORY_NAME_TAKEN' ? '此分類名稱已存在' : `錯誤：${data.error}`);
        return;
      }
      setNewCategoryName('');
      showToast('已新增分類');
      load();
    } finally {
      setCategorySubmitting(false);
    }
  }

  async function handleDeleteCategory(id: string) {
    const res = await fetch(`/api/activity-categories/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error === 'CATEGORY_IN_USE' ? '此分類仍有活動使用中，請先處理' : `錯誤：${data.error}`);
      return;
    }
    showToast('已刪除分類');
    load();
  }

  async function handleDeleteActivity() {
    if (!viewing) return;
    const confirmMessage =
      viewing.registrations.length > 0
        ? `已有 ${viewing.registrations.length} 人報名，刪除將一併取消他們的報名，確定嗎？`
        : '確定要刪除此活動嗎？';
    if (!confirm(confirmMessage)) return;
    await fetch(`/api/activities/${viewing.id}`, { method: 'DELETE' });
    setViewing(null);
    showToast('已刪除');
    load();
  }

  async function handleRemoveRegistration(registrationId: string) {
    await fetch(`/api/activity-registrations/${registrationId}`, { method: 'DELETE' });
    showToast('已移除');
    const res = await fetch('/api/activities');
    const updated: ActivityRow[] = await res.json();
    setActivities(updated);
    setViewing((prev) => (prev ? (updated.find((a) => a.id === prev.id) ?? null) : null));
  }

  const columns: Column<ActivityRow>[] = [
    {
      header: '封面',
      render: (a) =>
        a.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
          <img src={a.coverUrl} alt="封面" className="mx-auto h-10 w-10 rounded object-cover" />
        ) : (
          <div className="bg-stripe mx-auto h-10 w-10 rounded" />
        ),
    },
    { header: '標題', render: (a) => a.title },
    { header: '分類', render: (a) => a.category.name },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
    { header: '人數', render: (a) => `${a._count.registrations}/${a.capacity}` },
    { header: '狀態', render: (a) => (new Date(a.endDate) < startOfToday() ? '已結束' : '進行中') },
    {
      header: '操作',
      render: (a) => (
        <button className="text-brandDark hover:underline" onClick={() => setViewing(a)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">活動專區管理</h1>

      <div className="mb-6 flex flex-wrap gap-3">
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增活動</Button>}
        {!showCategoryPanel && (
          <Button variant="secondary" onClick={() => setShowCategoryPanel(true)}>
            管理分類
          </Button>
        )}
      </div>

      {showAddForm && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增活動</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={closeAddForm}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="標題" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <textarea
              placeholder="描述"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
              rows={3}
              required
            />
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>
              <option value="">請選擇分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input placeholder="地點（選填）" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            <Input
              type="number"
              min="1"
              placeholder="人數上限"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              required
            />
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium text-ink"
                onClick={() => setTeacherPickerOpen((open) => !open)}
              >
                <span>
                  帶領老師（至少選 1 位{formTeacherIds.length > 0 ? `，已選 ${formTeacherIds.length} 位` : ''}）
                </span>
                <span className="text-xs text-inkMuted">{teacherPickerOpen ? '收合' : '展開'}</span>
              </button>
              {teacherPickerOpen && (
                <div className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-borderStrong p-2">
                  {teachers.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={formTeacherIds.includes(t.id)} onChange={() => toggleFormTeacher(t.id)} />
                      {t.user.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium text-ink">照片（選填）</p>
                <input
                  ref={stagedFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => handleStagePhotos(e.target.files)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="px-3 py-1 text-xs"
                  onClick={() => stagedFileInputRef.current?.click()}
                >
                  ＋ 選擇照片
                </Button>
              </div>
              {stagedPhotos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {stagedPhotos.map((photo, i) => (
                    <div key={photo.previewUrl} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a remote asset next/image can optimize */}
                      <img src={photo.previewUrl} alt="待上傳照片" className="aspect-square w-full rounded-lg object-cover" />
                      <button
                        type="button"
                        aria-label="移除照片"
                        onClick={() => removeStagedPhoto(i)}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {formError && <p className="text-sm text-rejected">{formError}</p>}
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <ImageCropModal files={cropQueue} onDone={handleCroppedPhotos} />

      {showCategoryPanel && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">管理分類</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowCategoryPanel(false)}>
              收合
            </button>
          </div>
          {categories.length === 0 ? (
            <p className="mb-3 text-sm text-inkMuted">尚無分類</p>
          ) : (
            <ul className="mb-3 flex flex-col gap-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm text-ink">
                  {c.name}
                  <button type="button" className="text-rejected hover:underline" onClick={() => handleDeleteCategory(c.id)}>
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <Input
              placeholder="新分類名稱"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              required
              className="flex-1"
            />
            <Button type="submit" loading={categorySubmitting}>新增分類</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={activities}
          keyField={(a) => a.id}
          onRowClick={(a) => setViewing(a)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          loading={loading}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {viewing.category.name} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teachers.map((t) => t.teacher.user.name).join('、')} · {viewing.registrations.length}/{viewing.capacity}
            </p>
            {viewing.registrations.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生報名</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.registrations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm text-ink">
                    {r.student.user.name}
                    <button type="button" className="text-rejected hover:underline" onClick={() => handleRemoveRegistration(r.id)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="mt-2 text-left text-sm text-rejected hover:underline" onClick={handleDeleteActivity}>
              刪除此活動
            </button>
            <ActivityAlbum activityId={viewing.id} canManage />
          </div>
        )}
      </Modal>
    </>
  );
}
