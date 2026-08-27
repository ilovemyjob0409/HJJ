'use client';

import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { LOW_CLASS_QUOTA_THRESHOLD } from '@/lib/lowQuota';
import FamilySiblingModal from './FamilySiblingModal';

interface EnrollmentQuota {
  classId: string;
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

interface StudentRow {
  id: string;
  parentPhone: string | null;
  studentNumber: string | null;
  familyGroupId: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
  tutoringPrograms: { id: string; name: string }[];
}

interface ClassOption {
  id: string;
  name: string;
  subject: string;
  weekday: number;
}

// 編輯彈窗「已加入班級」表格的列：一般班級（可管理）或個別輔導方案（唯讀，
// 樣式與班級列統一；報名管理維持在個別輔導頁單一入口）。
type EnrolledRow = (ClassOption & { rowKind: 'class' }) | { rowKind: 'tutoring'; id: string; name: string };

// 該班未來的上課日（含今天起算的下一個上課日，共 count 週），
// 供續報彈窗勾選「未報名」日期。
function upcomingClassDates(weekday: number, count = 16): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

function LowQuotaIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline h-3.5 w-3.5 shrink-0"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function HintButton({
  label,
  active,
  onToggle,
  children,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-label={label}
        onClick={onToggle}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-borderStrong text-xs font-semibold text-ink hover:opacity-80"
      >
        ?
      </button>
      {active && (
        <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-borderStrong bg-card p-3 text-left text-xs text-inkMuted shadow-md">
          {children}
        </div>
      )}
    </div>
  );
}

function StudentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
  const [formEnrollments, setFormEnrollments] = useState<Record<string, string>>({});
  const [formClassQuery, setFormClassQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [familyModalStudent, setFamilyModalStudent] = useState<StudentRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
  const [editEnrollments, setEditEnrollments] = useState<Record<string, string>>({});
  const [addClassQuery, setAddClassQuery] = useState('');
  const [openHintClassId, setOpenHintClassId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 續報彈窗：目標班級、本期堂數、勾選的未報名日期
  const [renewTarget, setRenewTarget] = useState<ClassOption | null>(null);
  const [renewAmount, setRenewAmount] = useState('');
  const [renewDates, setRenewDates] = useState<Record<string, boolean>>({});
  // 未報名日期清單要列幾週：預設跟著堂數走（一週一堂），手動改過就不再跟
  const [renewWeeks, setRenewWeeks] = useState('16');
  const [renewWeeksTouched, setRenewWeeksTouched] = useState(false);
  // 未報名日期區塊預設收合，有需要再展開
  const [renewDatesOpen, setRenewDatesOpen] = useState(false);
  const [renewBusy, setRenewBusy] = useState(false);
  // 未報名日期獨立調整彈窗（不綁續報）：目標班級、勾選狀態、已標記的日期
  const [nrTarget, setNrTarget] = useState<ClassOption | null>(null);
  const [nrDates, setNrDates] = useState<Record<string, boolean>>({});
  const [nrExistingDates, setNrExistingDates] = useState<string[]>([]);
  const [nrWeeks, setNrWeeks] = useState('16');
  const [nrLoading, setNrLoading] = useState(false);
  const [nrBusy, setNrBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    editingIdRef.current = editing?.id ?? null;
  }, [editing]);

  async function load() {
    try {
      const [studentsRes, classesRes] = await Promise.all([fetch('/api/students'), fetch('/api/classes')]);
      setStudents(await studentsRes.json());
      setClasses(await classesRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const studentId = searchParams.get('studentId');
    if (!studentId || students.length === 0) return;
    const s = students.find((st) => st.id === studentId);
    if (s) openEdit(s);
    router.replace('/admin/students');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, students]);

  function enrollmentsFromMap(map: Record<string, string>) {
    return Object.entries(map).map(([classId, val]) => ({
      classId,
      totalSessions: val === '' ? null : Number(val),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setFormError('');
      const res = await fetch('/api/students', {
        method: 'POST',
        body: JSON.stringify({ ...form, enrollments: enrollmentsFromMap(formEnrollments) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(
          data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : data.error === 'STUDENT_NUMBER_TAKEN' ? '此學號已被使用' : `錯誤：${data.error}`
        );
        return;
      }
      setForm({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
      setFormEnrollments({});
      setShowAddForm(false);
      showToast('已新增');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFormClass(classId: string) {
    setFormEnrollments((prev) => {
      if (classId in prev) {
        const rest = { ...prev };
        delete rest[classId];
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  function openEdit(s: StudentRow) {
    setEditing(s);
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '', studentNumber: s.studentNumber ?? '' });
    setEditEnrollments(Object.fromEntries(s.enrollments.map((e) => [e.classId, e.totalSessions === null ? '' : String(e.totalSessions)])));
    setRenewTarget(null);
    setAddClassQuery('');
    setEditError('');
    setAdvancedOpen(false);
  }

  function toggleClass(classId: string) {
    setEditEnrollments((prev) => {
      if (classId in prev) {
        const rest = { ...prev };
        delete rest[classId];
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      setEditError('');
      const res = await fetch(`/api/students/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...editForm, enrollments: enrollmentsFromMap(editEnrollments) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(
          data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : data.error === 'STUDENT_NUMBER_TAKEN' ? '此學號已被使用' : `錯誤：${data.error}`
        );
        return;
      }
      setEditing(null);
      showToast('已儲存');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  // 實際列出的週數：1–52 的整數，其他輸入（清空、0、非數字）退回預設 16
  const renewWeeksCount = (() => {
    const n = Number(renewWeeks);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, 52) : 16;
  })();
  const renewDateOptions = renewTarget ? upcomingClassDates(renewTarget.weekday, renewWeeksCount) : [];
  // 只算目前清單內有勾的日期：把週數改小後，被藏起來的勾選不送出也不計數
  const renewSelectedDates = renewDateOptions.filter((d) => renewDates[d]);

  function openRenew(cls: ClassOption) {
    setRenewTarget(cls);
    setRenewAmount('');
    setRenewDates({});
    setRenewWeeks('16');
    setRenewWeeksTouched(false);
    setRenewDatesOpen(false);
  }

  function handleRenewAmountChange(value: string) {
    setRenewAmount(value);
    if (renewWeeksTouched) return;
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1) setRenewWeeks(String(Math.min(n, 52)));
    else setRenewWeeks('16');
  }

  async function handleRenewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !renewTarget) return;
    const amount = Number(renewAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      showToast('請輸入本期堂數（正整數）');
      return;
    }
    const selectedDates = renewSelectedDates;
    setRenewBusy(true);
    try {
      const res = await fetch(`/api/classes/${renewTarget.id}/enrollments`, {
        method: 'PATCH',
        body: JSON.stringify({ studentId: editing.id, addSessions: amount, notRegisteredDates: selectedDates }),
      });
      if (!res.ok) {
        showToast('續報失敗，請稍後再試');
        return;
      }
      const updated: { totalSessions: number | null } = await res.json();
      // 同步表單裡的總堂數與 Modal 顯示，避免之後按「儲存」把續報前的
      // 舊數字當校正送回去，蓋掉剛加上的堂數。
      setEditEnrollments((prev) => ({ ...prev, [renewTarget.id]: updated.totalSessions === null ? '' : String(updated.totalSessions) }));
      setEditing(
        (prev) =>
          prev && {
            ...prev,
            enrollments: prev.enrollments.map((en) =>
              en.classId === renewTarget.id
                ? {
                    ...en,
                    totalSessions: updated.totalSessions,
                    remaining: updated.totalSessions === null ? null : updated.totalSessions - en.usedSessions,
                  }
                : en
            ),
          }
      );
      showToast(
        selectedDates.length > 0 ? `已續報 ${amount} 堂，並預先標記 ${selectedDates.length} 天未報名` : `已續報 ${amount} 堂`
      );
      setRenewTarget(null);
      load();
    } finally {
      setRenewBusy(false);
    }
  }

  // 實際列出的週數：1–52 的整數，其他輸入退回預設 16（同續報彈窗）
  const nrWeeksCount = (() => {
    const n = Number(nrWeeks);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, 52) : 16;
  })();
  // 清單＝未來 N 週的上課日 ∪ 已標記的日期：已標記的永遠列出來（即使超出
  // 週數範圍），否則被藏起來的勾選會在儲存時被誤刪。
  const nrDateOptions = nrTarget
    ? Array.from(new Set([...upcomingClassDates(nrTarget.weekday, nrWeeksCount), ...nrExistingDates])).sort()
    : [];
  const nrSelectedDates = nrDateOptions.filter((d) => nrDates[d]);

  async function openNotRegistered(cls: ClassOption) {
    if (!editing) return;
    setNrTarget(cls);
    setNrDates({});
    setNrExistingDates([]);
    setNrWeeks('16');
    setNrLoading(true);
    try {
      const res = await fetch(`/api/classes/${cls.id}/not-registered-dates?studentId=${editing.id}`);
      if (!res.ok) {
        showToast('讀取未報名日期失敗');
        setNrTarget(null);
        return;
      }
      const { dates }: { dates: string[] } = await res.json();
      setNrExistingDates(dates);
      setNrDates(Object.fromEntries(dates.map((d) => [d, true])));
    } finally {
      setNrLoading(false);
    }
  }

  async function handleNotRegisteredSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !nrTarget) return;
    setNrBusy(true);
    try {
      const res = await fetch(`/api/classes/${nrTarget.id}/not-registered-dates`, {
        method: 'PUT',
        body: JSON.stringify({ studentId: editing.id, dates: nrSelectedDates }),
      });
      if (!res.ok) {
        showToast('儲存未報名日期失敗，請稍後再試');
        return;
      }
      showToast(nrSelectedDates.length > 0 ? `已更新未報名日期（共 ${nrSelectedDates.length} 天）` : '已清除所有未報名日期');
      setNrTarget(null);
      load();
    } finally {
      setNrBusy(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!(await confirm(`確定要刪除學生「${editing.user.name}」嗎？此操作無法復原。`, { danger: true }))) return;
    setEditError('');
    const res = await fetch(`/api/students/${editing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error === 'STUDENT_HAS_RECORDS' ? '此學生仍有請假、出缺勤、個別輔導、弈廳、活動或點數相關紀錄，請先處理後再刪除' : `錯誤：${data.error}`);
      return;
    }
    setEditing(null);
    showToast('已刪除');
    load();
  }

  const filteredStudents = students.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.user.name.toLowerCase().includes(q) ||
      s.user.email.toLowerCase().includes(q) ||
      (s.parentPhone ?? '').toLowerCase().includes(q)
    );
  });

  const columns: Column<StudentRow>[] = [
    { header: '姓名', render: (s) => s.user.name, sortValue: (s) => s.user.name },
    { header: '學號', render: (s) => s.studentNumber ?? '-', sortValue: (s) => s.studentNumber ?? null },
    { header: '帳號', render: (s) => s.user.email, sortValue: (s) => s.user.email },
    { header: '家長電話', render: (s) => s.parentPhone ?? '-', sortValue: (s) => s.parentPhone ?? null },
    {
      header: '班級數',
      render: (s) => s.enrollments.length + s.tutoringPrograms.length,
      sortValue: (s) => s.enrollments.length + s.tutoringPrograms.length,
    },
    {
      header: '操作',
      render: (s) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(s)}>
          編輯
        </button>
      ),
    },
  ];

  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  // 匯出採「一列一課程」：學生有幾種課程（一般班級＋個別輔導各算一種）就
  // 展開成幾列，每列重複基本資料，方便 Excel 篩選／樞紐分析；完全沒有
  // 課程的學生保留一列、班級欄留空。
  const exportRows = filteredStudents.flatMap((s) => {
    const courses = [
      ...s.enrollments.map((e) => classNameById.get(e.classId) ?? '').filter(Boolean),
      ...s.tutoringPrograms.map((p) => p.name),
    ];
    return courses.length === 0 ? [{ student: s, course: '' }] : courses.map((course) => ({ student: s, course }));
  });
  const exportColumns = [
    { header: '姓名', value: (r: { student: StudentRow; course: string }) => r.student.user.name },
    { header: '學號', value: (r: { student: StudentRow; course: string }) => r.student.studentNumber ?? '' },
    { header: '帳號', value: (r: { student: StudentRow; course: string }) => r.student.user.email },
    { header: '家長電話', value: (r: { student: StudentRow; course: string }) => r.student.parentPhone ?? '' },
    { header: '所屬班級', value: (r: { student: StudentRow; course: string }) => r.course },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">學生名單</h1>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜尋姓名、帳號或家長電話"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <ExportExcelButton rows={exportRows} columns={exportColumns} filename="學生名單" />
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增學生</Button>}
      </div>
      {showAddForm && (
        <Card className="mb-6 max-w-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增學生</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="帳號" type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input
              placeholder="初始密碼（留空預設 12345678）"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
            <Input placeholder="學號" value={form.studentNumber} onChange={(e) => setForm({ ...form, studentNumber: e.target.value })} />
            <div>
              <p className="mb-1 text-sm font-medium text-ink">所屬班級（可複選，可留空）</p>
              <Input
                placeholder="搜尋班級名稱或科目"
                value={formClassQuery}
                onChange={(e) => setFormClassQuery(e.target.value)}
                className="mb-2"
              />
              <div className="max-h-64 overflow-y-auto">
                <DataTable
                  columns={[
                    {
                      header: '',
                      render: (c) => (
                        <input type="checkbox" checked={c.id in formEnrollments} onChange={() => toggleFormClass(c.id)} />
                      ),
                    },
                    {
                      header: '班級',
                      render: (c) => (
                        <div className="text-left">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-inkMuted">{c.subject}</div>
                        </div>
                      ),
                    },
                    {
                      header: '總堂數',
                      render: (c) =>
                        c.id in formEnrollments ? (
                          <Input
                            type="number"
                            placeholder="留空＝不計"
                            value={formEnrollments[c.id] ?? ''}
                            onChange={(e) => setFormEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            className="w-24"
                          />
                        ) : (
                          <span className="text-inkMuted">—</span>
                        ),
                    },
                  ]}
                  rows={classes.filter((c) => {
                    const q = formClassQuery.trim().toLowerCase();
                    if (!q) return true;
                    return c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q);
                  })}
                  keyField={(c) => c.id}
                  emptyText="找不到符合的班級"
                />
              </div>
            </div>
            {formError && <p className="text-sm text-rejected">{formError}</p>}
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={filteredStudents}
          keyField={(s) => s.id}
          loading={loading}
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          emptyText="目前沒有學生"
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯學生" maxWidthClassName="max-w-2xl">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-sm font-medium text-ink">基本資料</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input placeholder="姓名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              <Input
                placeholder="帳號"
                type="text"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                required
              />
              <Input
                placeholder="家長電話"
                value={editForm.parentPhone}
                onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
              />
              <Input
                placeholder="學號"
                value={editForm.studentNumber}
                onChange={(e) => setEditForm({ ...editForm, studentNumber: e.target.value })}
              />
              <Input
                placeholder="新密碼（留空＝不變更）"
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                className="sm:col-span-2"
              />
            </div>
          </div>

          <div className="border-t border-borderSubtle pt-6">
            <p className="mb-2 text-sm font-medium text-ink">班級</p>
            <div className="flex flex-col gap-3 rounded-lg bg-background p-3">
              <div>
                <p className="mb-1 text-xs font-medium text-inkMuted">已加入班級</p>
                {Object.keys(editEnrollments).length === 0 && (editing?.tutoringPrograms.length ?? 0) === 0 ? (
                  <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">
                    尚未加入任何班級
                  </p>
                ) : (
                  <DataTable
                    columns={[
                      {
                        header: '班級',
                        render: (c: EnrolledRow) => (
                          <div className="text-left">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-inkMuted">{c.rowKind === 'class' ? c.subject : '個別輔導'}</div>
                          </div>
                        ),
                      },
                      {
                        header: '總堂數',
                        render: (c: EnrolledRow) =>
                          c.rowKind === 'tutoring' ? (
                            <span className="text-xs text-inkMuted">月額度制</span>
                          ) : (
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              value={editEnrollments[c.id] ?? ''}
                              onChange={(e) => setEditEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              className="w-24"
                            />
                            <HintButton
                              label="總堂數說明"
                              active={openHintClassId === c.id}
                              onToggle={() => setOpenHintClassId((prev) => (prev === c.id ? null : c.id))}
                            >
                              留空表示不追蹤堂數——「已上／剩餘」會顯示「未追蹤」，點名也不會扣堂。填數字才會開始計算已上與剩餘堂數。
                            </HintButton>
                          </div>
                          ),
                      },
                      {
                        header: '已上／剩餘',
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment || enrollment.totalSessions === null) {
                            return <span className="text-xs text-inkMuted">未追蹤</span>;
                          }
                          const low = enrollment.remaining !== null && enrollment.remaining <= LOW_CLASS_QUOTA_THRESHOLD;
                          return (
                            <span className={`flex items-center justify-center gap-1 text-xs ${low ? 'font-semibold text-pending' : 'text-inkMuted'}`}>
                              {low && <LowQuotaIcon />}
                              已上 {enrollment.usedSessions}／剩餘 {enrollment.remaining}
                            </span>
                          );
                        },
                      },
                      {
                        header: (
                          <span className="flex items-center justify-center gap-1">
                            續報
                            <HintButton
                              label="續報說明"
                              active={openHintClassId === 'period-header'}
                              onToggle={() => setOpenHintClassId((prev) => (prev === 'period-header' ? null : 'period-header'))}
                            >
                              續報＝這期報課：堂數會累加到總堂數，圍棋班的一對一補課額度同時重新起算；可順便勾選這期不出席的日期，預先標為「未報名」（不扣堂）。直接修改「總堂數」欄位則是校正，不會開新的一期。
                            </HintButton>
                          </span>
                        ),
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                          return (
                            <button
                              type="button"
                              onClick={() => openRenew(c)}
                              className="whitespace-nowrap text-xs text-brandDark hover:underline"
                            >
                              續報
                            </button>
                          );
                        },
                      },
                      {
                        header: (
                          <span className="flex items-center justify-center gap-1">
                            未報名
                            <HintButton
                              label="未報名日期說明"
                              active={openHintClassId === 'nr-header'}
                              onToggle={() => setOpenHintClassId((prev) => (prev === 'nr-header' ? null : 'nr-header'))}
                            >
                              調整這位學生未來不出席的上課日：勾選的日期會在點名中預先標為「未報名」（不扣堂）；取消勾選會移除標記。只能調整今天以後的日期。
                            </HintButton>
                          </span>
                        ),
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                          return (
                            <button
                              type="button"
                              onClick={() => openNotRegistered(c)}
                              className="whitespace-nowrap text-xs text-brandDark hover:underline"
                            >
                              調整
                            </button>
                          );
                        },
                      },
                      {
                        header: '',
                        render: (c: EnrolledRow) =>
                          c.rowKind === 'tutoring' ? (
                            <Link
                              href={`/admin/tutoring?student=${editing?.id ?? ''}`}
                              className="whitespace-nowrap text-xs text-brandDark hover:underline"
                            >
                              前往管理
                            </Link>
                          ) : (
                            <button type="button" className="text-xs text-rejected hover:underline" onClick={() => toggleClass(c.id)}>
                              移除
                            </button>
                          ),
                      },
                    ]}
                    rows={[
                      ...classes.filter((c) => c.id in editEnrollments).map((c) => ({ ...c, rowKind: 'class' as const })),
                      ...(editing?.tutoringPrograms ?? []).map((p) => ({ rowKind: 'tutoring' as const, id: `tutoring-${p.id}`, name: p.name })),
                    ]}
                    keyField={(c) => c.id}
                  />
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-inkMuted">加入新班級</p>
                <Input
                  placeholder="搜尋班級名稱或科目加入…"
                  value={addClassQuery}
                  onChange={(e) => setAddClassQuery(e.target.value)}
                />
                {addClassQuery.trim() &&
                  (() => {
                    const q = addClassQuery.trim().toLowerCase();
                    const matches = classes
                      .filter((c) => !(c.id in editEnrollments))
                      .filter((c) => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q))
                      .slice(0, 8);
                    if (matches.length === 0) {
                      return <p className="mt-2 text-sm text-inkMuted">找不到符合的班級</p>;
                    }
                    return (
                      <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
                        {matches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              toggleClass(c.id);
                              setAddClassQuery('');
                            }}
                            className="flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe"
                          >
                            <span>
                              {c.name}（{c.subject}）
                            </span>
                            <span className="text-xs text-brandDark">加入</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
              </div>
            </div>
          </div>

          <div className="border-t border-borderSubtle pt-6">
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm font-medium text-ink"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <span>進階設定</span>
              <span className="text-xs text-inkMuted">{advancedOpen ? '收合' : '展開'}</span>
            </button>
            {advancedOpen && (
              <div className="mt-3 flex flex-col gap-4">
                <div>
                  <p className="mb-1 text-xs font-medium text-inkMuted">手足帳號</p>
                  <div className="rounded-lg bg-background p-3">
                    <Button type="button" variant="secondary" onClick={() => editing && setFamilyModalStudent(editing)}>
                      設定手足
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {editError && <p className="text-sm text-rejected">{editError}</p>}
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button
          type="button"
          className="mt-6 w-full border-t border-borderSubtle pt-4 text-left text-sm text-rejected hover:underline"
          onClick={handleDelete}
        >
          刪除學生
        </button>
      </Modal>

      <Modal
        open={renewTarget !== null}
        onClose={() => setRenewTarget(null)}
        title={`續報：${editing?.user.name ?? ''}（${renewTarget?.name ?? ''}）`}
      >
        {renewTarget && (
          <form onSubmit={handleRenewSubmit} className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-ink">本期堂數</p>
              <Input
                type="number"
                min={1}
                placeholder="堂數"
                value={renewAmount}
                onChange={(e) => handleRenewAmountChange(e.target.value)}
                className="w-28"
                required
              />
            </div>

            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium text-ink"
                onClick={() => setRenewDatesOpen((open) => !open)}
              >
                <span>
                  未報名日期（可複選{renewSelectedDates.length > 0 ? `，已選 ${renewSelectedDates.length} 天` : ''}）
                </span>
                <span className="text-xs text-inkMuted">{renewDatesOpen ? '收合' : '展開'}</span>
              </button>
              {renewDatesOpen && (
              <>
              <div className="mb-1 mt-1 flex items-center gap-2 text-xs text-inkMuted">
                <span>列出未來</span>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={renewWeeks}
                  onChange={(e) => {
                    setRenewWeeks(e.target.value);
                    setRenewWeeksTouched(true);
                  }}
                  className="w-16"
                />
                <span>週的上課日（預設跟著堂數）</span>
              </div>
              <p className="mb-2 text-xs text-inkMuted">
                這個班未來的上課日。勾選的日期會預先在點名中標為「未報名」，不扣堂，之後不用再改。
              </p>
              <div className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-borderSubtle">
                {renewDateOptions.map((d) => {
                  const selected = !!renewDates[d];
                  return (
                    <label
                      key={d}
                      className={`flex cursor-pointer items-center gap-2 border-b border-borderSubtle px-3 py-2 text-sm last:border-b-0 ${
                        selected ? 'bg-stripe font-semibold text-brandDark' : 'text-ink hover:bg-stripe'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setRenewDates((prev) => ({ ...prev, [d]: !prev[d] }))}
                      />
                      {formatDateWithWeekday(d)}
                    </label>
                  );
                })}
              </div>
              </>
              )}
            </div>

            <Button type="submit" loading={renewBusy}>
              確認續報
              {Number(renewAmount) > 0 ? `（${Number(renewAmount)} 堂${renewSelectedDates.length > 0 ? `・${renewSelectedDates.length} 天未報名` : ''}）` : ''}
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        open={nrTarget !== null}
        onClose={() => setNrTarget(null)}
        title={`未報名日期：${editing?.user.name ?? ''}（${nrTarget?.name ?? ''}）`}
      >
        {nrTarget &&
          (nrLoading ? (
            <div className="flex flex-col gap-2">
              <div className="skeleton-shimmer h-4 w-full rounded" />
              <div className="skeleton-shimmer h-4 w-full rounded" />
              <div className="skeleton-shimmer h-4 w-full rounded" />
            </div>
          ) : (
            <form onSubmit={handleNotRegisteredSubmit} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs text-inkMuted">
                <span>列出未來</span>
                <Input type="number" min={1} max={52} value={nrWeeks} onChange={(e) => setNrWeeks(e.target.value)} className="w-16" />
                <span>週的上課日</span>
              </div>
              <p className="text-xs text-inkMuted">
                勾選＝這天不出席，點名會預先標為「未報名」（不扣堂）；取消勾選＝移除標記。已標記的日期一定會列出，只能調整今天以後的日期。
              </p>
              <div className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-borderSubtle">
                {nrDateOptions.map((d) => {
                  const selected = !!nrDates[d];
                  return (
                    <label
                      key={d}
                      className={`flex cursor-pointer items-center gap-2 border-b border-borderSubtle px-3 py-2 text-sm last:border-b-0 ${
                        selected ? 'bg-stripe font-semibold text-brandDark' : 'text-ink hover:bg-stripe'
                      }`}
                    >
                      <input type="checkbox" checked={selected} onChange={() => setNrDates((prev) => ({ ...prev, [d]: !prev[d] }))} />
                      {formatDateWithWeekday(d)}
                    </label>
                  );
                })}
              </div>
              <Button type="submit" loading={nrBusy}>
                儲存{nrSelectedDates.length > 0 ? `（已選 ${nrSelectedDates.length} 天未報名）` : '（清除所有未報名標記）'}
              </Button>
            </form>
          ))}
      </Modal>

      {familyModalStudent && (
        <FamilySiblingModal
          student={familyModalStudent}
          allStudents={students}
          onClose={() => setFamilyModalStudent(null)}
          onSaved={load}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

export default function StudentsPage() {
  return (
    <Suspense fallback={null}>
      <StudentsContent />
    </Suspense>
  );
}
