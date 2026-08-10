'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import AdminBookingModal from './AdminBookingModal';

interface EnrollmentRow {
  id: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  active: boolean;
  locked: number;
  upcoming: number;
}

interface StudentOption {
  id: string;
  user: { name: string };
}

interface ProgramOption {
  id: string;
  name: string;
}

export default function EnrollmentManager() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [programId, setProgramId] = useState('');
  const [newMonthlyQuota, setNewMonthlyQuota] = useState('');
  const [quotaOverride, setQuotaOverride] = useState<Record<string, string>>({});
  const [editingEnrollment, setEditingEnrollment] = useState<EnrollmentRow | null>(null);
  const [bookingTarget, setBookingTarget] = useState<EnrollmentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const [enrollmentsRes, studentsRes, programsRes] = await Promise.all([
      fetch('/api/tutoring-enrollments'),
      fetch('/api/students'),
      fetch('/api/tutoring-programs'),
    ]);
    setEnrollments(await enrollmentsRes.json());
    setStudents(await studentsRes.json());
    setPrograms(await programsRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function createEnrollments() {
    if (selectedStudentIds.length === 0 || !programId) {
      showToast('請選擇至少一位學生與課程');
      return;
    }
    const quota = newMonthlyQuota === '' ? undefined : Number(newMonthlyQuota);
    setSubmitting(true);
    try {
      const results = await Promise.all(
        selectedStudentIds.map(async (id) => {
          const name = students.find((s) => s.id === id)?.user.name ?? id;
          try {
            const res = await fetch('/api/tutoring-enrollments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ studentId: id, programId, monthlyQuota: quota }),
            });
            return { name, ok: res.ok };
          } catch {
            return { name, ok: false };
          }
        })
      );
      const failed = results.filter((r) => !r.ok);
      const succeeded = results.length - failed.length;
      if (failed.length === 0) {
        showToast(`已新增 ${succeeded} 筆報名`);
      } else if (succeeded === 0) {
        showToast(`新增失敗：${failed.map((f) => f.name).join('、')}（可能已報名此課程）`);
      } else {
        showToast(`已新增 ${succeeded} 筆報名，${failed.length} 筆失敗：${failed.map((f) => f.name).join('、')}`);
      }
      if (succeeded > 0) {
        setSelectedStudentIds([]);
        setProgramId('');
        setNewMonthlyQuota('');
      }
      setStudentQuery('');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function saveQuotaOverride(row: EnrollmentRow) {
    const raw = quotaOverride[row.id];
    const monthlyQuota = raw === '' || raw === undefined ? null : Number(raw);
    const res = await fetch(`/api/tutoring-enrollments/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyQuota }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return;
    }
    showToast('已更新額度');
    load();
  }

  async function toggleActive(row: EnrollmentRow): Promise<boolean> {
    const res = await fetch(`/api/tutoring-enrollments/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !row.active }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return false;
    }
    load();
    return true;
  }

  async function removeEnrollment(row: EnrollmentRow): Promise<boolean> {
    if (!(await confirm(`確定要移除「${row.studentName}」的「${row.programName}」報名嗎？`, { danger: true }))) return false;
    const res = await fetch(`/api/tutoring-enrollments/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return false;
    }
    showToast('已移除');
    load();
    return true;
  }

  const columns: Column<EnrollmentRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    {
      header: '本月狀態',
      render: (r) => (
        <>
          已計次 {r.locked}／{r.monthlyQuota} 堂
          <br />
          <span className="text-xs text-inkMuted">（另 {r.upcoming} 堂待到）</span>
          {!r.active && (
            <>
              <br />
              <span className="text-xs text-rejected">（已停用）</span>
            </>
          )}
        </>
      ),
    },
    {
      header: '操作',
      render: (r) => (
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditingEnrollment(r)}>
          編輯
        </Button>
      ),
    },
  ];

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold text-ink">學生報名管理</h2>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-inkMuted">
            學生
            {selectedStudentIds.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {selectedStudentIds.map((id) => {
                  const name = students.find((s) => s.id === id)?.user.name ?? id;
                  return (
                    <span key={id} className="flex items-center gap-1 rounded-full bg-stripe px-2 py-0.5 text-xs text-inkMuted">
                      {name}
                      <button
                        type="button"
                        onClick={() => setSelectedStudentIds((prev) => prev.filter((sid) => sid !== id))}
                        className="text-rejected"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="relative mt-1">
              <div className="flex items-center gap-1.5 rounded-lg border border-borderSubtle bg-card px-2 py-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 shrink-0 text-inkMuted"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.2" y2="16.2" />
                </svg>
                <input
                  type="text"
                  placeholder="搜尋學生姓名"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  className="w-32 bg-transparent text-sm text-ink outline-none"
                />
              </div>
              {studentQuery.trim() && (
                <div className="absolute z-10 mt-1 max-h-48 w-48 overflow-y-auto rounded-lg border border-borderStrong bg-card shadow-lg">
                  {(() => {
                    const q = studentQuery.trim().toLowerCase();
                    const matches = students
                      .filter((s) => !selectedStudentIds.includes(s.id) && s.user.name.toLowerCase().includes(q))
                      .slice(0, 8);
                    if (matches.length === 0) {
                      return <p className="p-2 text-xs text-inkMuted">找不到符合的學生</p>;
                    }
                    return matches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudentIds((prev) => (prev.includes(s.id) ? prev : [...prev, s.id]));
                          setStudentQuery('');
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-stripe"
                      >
                        {s.user.name}
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
          </label>
          <label className="text-xs text-inkMuted">
            課程
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink">
              <option value="">請選擇</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-inkMuted">
            每月堂數
            <Input
              type="number"
              min={0}
              placeholder="預設"
              value={newMonthlyQuota}
              onChange={(e) => setNewMonthlyQuota(e.target.value)}
              className="mt-1 block w-20 py-1 text-sm"
            />
          </label>
          <Button onClick={createEnrollments} loading={submitting}>新增報名</Button>
        </div>
      </Card>
      <Card>
        <DataTable columns={columns} rows={enrollments} keyField={(r) => r.id} emptyText="目前沒有學生報名個別輔導" />
      </Card>
      <Modal
        open={editingEnrollment !== null}
        onClose={() => setEditingEnrollment(null)}
        title={`${editingEnrollment?.studentName ?? ''}・${editingEnrollment?.programName ?? ''}`}
      >
        {editingEnrollment && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-inkMuted">每月堂數覆寫</p>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  placeholder="預設"
                  value={quotaOverride[editingEnrollment.id] ?? ''}
                  onChange={(e) => setQuotaOverride((prev) => ({ ...prev, [editingEnrollment.id]: e.target.value }))}
                  className="w-20 py-1 text-sm"
                />
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => saveQuotaOverride(editingEnrollment)}>
                  儲存
                </Button>
              </div>
            </div>
            {editingEnrollment.active ? (
              <Button onClick={() => setBookingTarget(editingEnrollment)}>預約</Button>
            ) : (
              <p className="text-xs text-inkMuted">已停用，請先啟用才能預約</p>
            )}
            <Button
              variant="secondary"
              onClick={async () => {
                if (await toggleActive(editingEnrollment)) setEditingEnrollment(null);
              }}
            >
              {editingEnrollment.active ? '停用' : '啟用'}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (await removeEnrollment(editingEnrollment)) setEditingEnrollment(null);
              }}
            >
              移除
            </Button>
          </div>
        )}
      </Modal>
      {bookingTarget && (
        <AdminBookingModal enrollment={bookingTarget} onClose={() => setBookingTarget(null)} onBooked={load} />
      )}
      {ConfirmDialog}
    </>
  );
}
