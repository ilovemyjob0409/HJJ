'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface EnrollmentRow {
  id: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
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
  const [studentId, setStudentId] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [programId, setProgramId] = useState('');
  const [newMonthlyQuota, setNewMonthlyQuota] = useState('');
  const [quotaOverride, setQuotaOverride] = useState<Record<string, string>>({});

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

  async function createEnrollment() {
    if (!studentId || !programId) {
      showToast('請選擇學生與課程');
      return;
    }
    const res = await fetch('/api/tutoring-enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        programId,
        monthlyQuota: newMonthlyQuota === '' ? undefined : Number(newMonthlyQuota),
      }),
    });
    if (!res.ok) {
      showToast('新增失敗，該學生可能已報名此課程');
      return;
    }
    setStudentId('');
    setStudentQuery('');
    setProgramId('');
    setNewMonthlyQuota('');
    showToast('已新增報名');
    load();
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

  async function toggleActive(row: EnrollmentRow) {
    const res = await fetch(`/api/tutoring-enrollments/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !row.active }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return;
    }
    load();
  }

  async function removeEnrollment(row: EnrollmentRow) {
    if (!(await confirm(`確定要移除「${row.studentName}」的「${row.programName}」報名嗎？`, { danger: true }))) return;
    const res = await fetch(`/api/tutoring-enrollments/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return;
    }
    showToast('已移除');
    load();
  }

  const columns: Column<EnrollmentRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '本月狀態', render: (r) => `已計次 ${r.locked}／${r.monthlyQuota} 堂（另 ${r.upcoming} 堂待到）` },
    {
      header: '額度覆寫',
      render: (r) => (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            placeholder="預設"
            value={quotaOverride[r.id] ?? ''}
            onChange={(e) => setQuotaOverride((prev) => ({ ...prev, [r.id]: e.target.value }))}
            className="w-16 py-1 text-xs"
          />
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => saveQuotaOverride(r)}>
            儲存
          </Button>
        </div>
      ),
    },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => toggleActive(r)}>
            {r.active ? '停用' : '啟用'}
          </Button>
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => removeEnrollment(r)}>
            移除
          </Button>
        </div>
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
                  value={studentId ? (students.find((s) => s.id === studentId)?.user.name ?? '') : studentQuery}
                  onChange={(e) => {
                    setStudentId('');
                    setStudentQuery(e.target.value);
                  }}
                  className="w-32 bg-transparent text-sm text-ink outline-none"
                />
              </div>
              {!studentId && studentQuery.trim() && (
                <div className="absolute z-10 mt-1 max-h-48 w-48 overflow-y-auto rounded-lg border border-borderStrong bg-card shadow-lg">
                  {(() => {
                    const q = studentQuery.trim().toLowerCase();
                    const matches = students.filter((s) => s.user.name.toLowerCase().includes(q)).slice(0, 8);
                    if (matches.length === 0) {
                      return <p className="p-2 text-xs text-inkMuted">找不到符合的學生</p>;
                    }
                    return matches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setStudentId(s.id);
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
              className="mt-1 w-20 py-1 text-sm"
            />
          </label>
          <Button onClick={createEnrollment}>新增報名</Button>
        </div>
      </Card>
      <Card>
        <DataTable columns={columns} rows={enrollments} keyField={(r) => r.id} emptyText="目前沒有學生報名個別輔導" />
      </Card>
      {ConfirmDialog}
    </>
  );
}
