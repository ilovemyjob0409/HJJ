'use client';

import { useEffect, useRef, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import ActivityDetail from '@/components/ActivityDetail';
import ActivityFormFields, { ActivityFormValues, EMPTY_ACTIVITY_FORM } from '@/components/ActivityFormFields';
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
  createdAt: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  coverUrl: string | null;
  title: string;
  description: string;
  categoryId: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacherId: string; teacher: { user: { name: string } } }[];
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
  const { confirm, ConfirmDialog } = useConfirm();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ActivityFormValues>(EMPTY_ACTIVITY_FORM);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [editForm, setEditForm] = useState<ActivityFormValues>(EMPTY_ACTIVITY_FORM);
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [viewing, setViewing] = useState<ActivityRow | null>(null);
  // 行政代報名：學生名單（首次開詳情彈窗才抓）＋選擇狀態
  const [allStudents, setAllStudents] = useState<{ id: string; studentNumber: string | null; user: { name: string } }[]>([]);
  const [addStudentId, setAddStudentId] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);
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
      if (form.teacherIds.length === 0) {
        setFormError('請至少選擇一位帶領老師');
        return;
      }
      const res = await fetch('/api/activities', {
        method: 'POST',
        body: JSON.stringify({ ...form, capacity: Number(form.capacity) }),
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
      setForm(EMPTY_ACTIVITY_FORM);
      setShowAddForm(false);
      showToast(failedPhotos === 0 ? '已新增活動' : `已新增活動，但有 ${failedPhotos} 張照片上傳失敗`);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(a: ActivityRow) {
    setEditForm({
      title: a.title,
      description: a.description,
      categoryId: a.categoryId,
      location: a.location ?? '',
      startDate: a.startDate.slice(0, 10),
      endDate: a.endDate.slice(0, 10),
      capacity: String(a.capacity),
      teacherIds: a.teachers.map((t) => t.teacherId),
    });
    setEditError('');
    setViewing(null);
    setEditing(a);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSubmitting(true);
    try {
      setEditError('');
      if (editForm.teacherIds.length === 0) {
        setEditError('請至少選擇一位帶領老師');
        return;
      }
      const res = await fetch(`/api/activities/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...editForm, capacity: Number(editForm.capacity) }),
      });
      if (!res.ok) {
        setEditError('更新活動失敗，請稍後再試');
        return;
      }
      setEditing(null);
      showToast('已更新活動');
      load();
    } finally {
      setEditSubmitting(false);
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
    if (!(await confirm(confirmMessage, { danger: true }))) return;
    const res = await fetch(`/api/activities/${viewing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有出缺勤紀錄');
      return;
    }
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

  useEffect(() => {
    if (!viewing || allStudents.length > 0) return;
    fetch('/api/students')
      .then((r) => (r.ok ? r.json() : []))
      .then(setAllStudents)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing]);

  async function handleAdminRegister() {
    if (!viewing || !addStudentId) return;
    setAddingStudent(true);
    try {
      const res = await fetch('/api/activity-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: viewing.id, studentId: addStudentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error === 'ALREADY_REGISTERED' ? '這位學生已報名過' : '報名失敗，請稍後再試');
        return;
      }
      showToast('已幫學生報名');
      setAddStudentId('');
      const listRes = await fetch('/api/activities');
      const updated: ActivityRow[] = await listRes.json();
      setActivities(updated);
      setViewing((prev) => (prev ? (updated.find((a) => a.id === prev.id) ?? null) : null));
    } finally {
      setAddingStudent(false);
    }
  }

  const columns: Column<ActivityRow>[] = [
    {
      header: '封面',
      width: 'w-40',
      render: (a) =>
        a.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
          <img src={a.coverUrl} alt="封面" className="mx-auto h-20 w-32 max-w-full rounded object-cover" />
        ) : (
          <div className="bg-stripe mx-auto h-20 w-32 max-w-full rounded" />
        ),
    },
    { header: '標題', render: (a) => a.title, sortValue: (a) => a.title },
    { header: '分類', render: (a) => a.category.name, sortValue: (a) => a.category.name },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
    { header: '人數', render: (a) => `${a._count.registrations}/${a.capacity}` },
    {
      header: '狀態',
      render: (a) => (new Date(a.endDate) < startOfToday() ? '已結束' : '進行中'),
      sortValue: (a) => (new Date(a.endDate) < startOfToday() ? 1 : 0),
    },
    {
      header: '操作',
      render: (a) => (
        <Button
          variant="link"
          onClick={(e) => {
            e.stopPropagation();
            openEdit(a);
          }}
        >
          編輯
        </Button>
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
            <Button variant="link" tone="muted" className="text-sm" onClick={closeAddForm}>
              收合
            </Button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <ActivityFormFields values={form} onChange={setForm} categories={categories} teachers={teachers} />
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
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowCategoryPanel(false)}>
              收合
            </Button>
          </div>
          {categories.length === 0 ? (
            <p className="mb-3 text-sm text-inkMuted">尚無分類</p>
          ) : (
            <ul className="mb-3 flex flex-col gap-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm text-ink">
                  {c.name}
                  <Button variant="link" tone="danger" onClick={() => handleDeleteCategory(c.id)}>
                    刪除
                  </Button>
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
          emptyText="目前沒有活動"
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} flush maxWidthClassName="max-w-xl">
        {viewing && (
          <ActivityDetail
            key={viewing.id}
            activity={viewing}
            onClose={() => setViewing(null)}
            canManageAlbum
            onImagesChanged={load}
            rosterHeaderAction={
              <div className="flex items-center gap-2">
                <Select
                  value={addStudentId}
                  onChange={(e) => setAddStudentId(e.target.value)}
                  className="min-w-0 py-1 text-xs"
                  aria-label="選擇要代報名的學生"
                >
                  <option value="">選擇學生…</option>
                  {allStudents
                    .filter((st) => !viewing.registrations.some((r) => r.studentId === st.id))
                    .map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.user.name}
                        {st.studentNumber ? `（${st.studentNumber}）` : ''}
                      </option>
                    ))}
                </Select>
                <Button
                  type="button"
                  variant="link"
                  className="whitespace-nowrap text-xs"
                  loading={addingStudent}
                  disabled={!addStudentId}
                  onClick={handleAdminRegister}
                >
                  幫學生報名
                </Button>
              </div>
            }
            rosterItemAction={(r) => (
              <Button variant="link" tone="danger" className="text-xs" onClick={() => handleRemoveRegistration(r.id)}>
                移除
              </Button>
            )}
            footer={
              <div className="flex items-center gap-4">
                <Button variant="link" className="text-sm" onClick={() => openEdit(viewing)}>
                  編輯活動
                </Button>
                <Button variant="link" tone="danger" className="text-sm" onClick={handleDeleteActivity}>
                  刪除此活動
                </Button>
              </div>
            }
          />
        )}
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯活動">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2">
          <ActivityFormFields values={editForm} onChange={setEditForm} categories={categories} teachers={teachers} />
          {editError && <p className="text-sm text-rejected">{editError}</p>}
          <Button type="submit" loading={editSubmitting}>儲存</Button>
        </form>
      </Modal>
      {ConfirmDialog}
    </>
  );
}
