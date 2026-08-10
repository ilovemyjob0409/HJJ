# 個別輔導：預約搬到報名列表、報名支援多選 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the admin "新增預約" action from `/admin/tutoring/bookings` into a per-row "編輯" flow on the enrollment list at `/admin/tutoring`, and let admins register multiple students in one enrollment submission instead of one at a time.

**Architecture:** Three purely front-end changes to existing client components — no API or service files change. `EnrollmentManager.tsx`'s registration form moves from single-select to multi-select with parallel per-student POSTs; its enrollment table collapses the "額度覆寫" and "操作" columns into a single "編輯" button that opens a Modal (quota override / book / toggle-active / remove), which itself can stack a new `AdminBookingModal.tsx` (reusing the existing `TutoringBookingCalendar` component) for per-row booking. `/admin/tutoring/bookings/page.tsx` loses its now-redundant "新增預約" card.

**Tech Stack:** Next.js 14 (App Router, client components), React state, existing UI kit (`Card`, `Button`, `Input`, `DataTable`, `Modal`), existing `TutoringBookingCalendar` component, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-tutoring-enrollment-booking-relocation-design.md` — follow it for anything not covered by a task below.
- No backend files change: nothing under `src/app/api/` or `src/lib/services/` is touched by any task in this plan (`git diff --stat` against `main` at the end of the branch must show changes only under `src/app/admin/tutoring/`).
- Reuse existing UI components/utilities exactly as they're already used elsewhere in this codebase (`Card`, `Button`, `Input`, `DataTable`, `Modal`, `useToast`, `useConfirm`, `formatDateWithWeekday`, `TutoringBookingCalendar`) — do not introduce new styling primitives.
- This codebase has no component-test convention (only `src/**/*.test.ts` service/route tests run under Vitest). Do not add `.test.tsx` files; verify frontend tasks by running the dev server and checking in the browser.
- `npx tsc --noEmit` and `npm test` must stay clean after every task. The full suite is backend-only and untouched by this plan, so any failure after a task signals an accidental break (bad import, stale type), not a real conflict.

---

### Task 1: 新增報名支援多選學生

**Files:**
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx` (full rewrite)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: this task's `EnrollmentManager.tsx` is the file Task 2 continues editing. `EnrollmentRow` stays exactly as it is today (`id, studentId, studentName, programId, programName, monthlyQuota, active, locked, upcoming`) — Task 2 adds `defaultDurationMinutes` to it. The `columns` array (5 columns: 學生／課程／本月狀態／額度覆寫／操作) is untouched by this task — Task 2 changes it.

- [ ] **Step 1: Replace the full contents of `EnrollmentManager.tsx`**

```tsx
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
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
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

  async function createEnrollments() {
    if (selectedStudentIds.length === 0 || !programId) {
      showToast('請選擇至少一位學生與課程');
      return;
    }
    const quota = newMonthlyQuota === '' ? undefined : Number(newMonthlyQuota);
    const results = await Promise.all(
      selectedStudentIds.map(async (id) => {
        const res = await fetch('/api/tutoring-enrollments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: id, programId, monthlyQuota: quota }),
        });
        const name = students.find((s) => s.id === id)?.user.name ?? id;
        return { name, ok: res.ok };
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
    {
      header: '本月狀態',
      render: (r) => (
        <>
          已計次 {r.locked}／{r.monthlyQuota} 堂
          <br />
          <span className="text-xs text-inkMuted">（另 {r.upcoming} 堂待到）</span>
        </>
      ),
    },
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
            {selectedStudentIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
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
          <Button onClick={createEnrollments}>新增報名</Button>
        </div>
      </Card>
      <Card>
        <DataTable columns={columns} rows={enrollments} keyField={(r) => r.id} emptyText="目前沒有學生報名個別輔導" />
      </Card>
      {ConfirmDialog}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (backend suite untouched by this frontend-only change).

- [ ] **Step 4: Manually verify in the browser**

```bash
npm run dev
```

Log in as admin, go to `/admin/tutoring`, in "學生報名管理":
- Type a partial name into the 學生 search box, confirm the dropdown filters live; click 2–3 different students, confirm a chip appears for each and the input clears back to empty after each pick (still focused/ready to search the next one).
- Confirm a student already picked no longer appears in the dropdown when you search their name again.
- Click the ✕ on one chip, confirm it's removed from the chip row and reappears in the dropdown if you search for them again.
- Pick a 課程 and a 每月堂數, click 新增報名. Confirm the toast reads "已新增 N 筆報名" and all N rows appear in the table below; confirm the chips/course/quota fields all cleared.
- Repeat, but include one student who is already enrolled in the picked course mixed in with 1-2 new students. Confirm the toast lists the failed name(s) (e.g. "已新增 1 筆報名，1 筆失敗：小明") and only the new student's row was added.
- Repeat once more picking only already-enrolled students (all fail). Confirm the toast reads "新增失敗：...（可能已報名此課程）" and the chips/course/quota stay filled in (not cleared) so you can adjust and retry without re-searching.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/tutoring/EnrollmentManager.tsx
git commit -m "feat(tutoring): support multi-select students when creating enrollments"
```

---

### Task 2: 已報名列表操作欄＋額度覆寫欄合併成「編輯」按鈕，含預約 Modal

**Files:**
- Create: `src/app/admin/tutoring/AdminBookingModal.tsx`
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx` (full rewrite, continuing from Task 1's version)

**Interfaces:**
- Consumes: Task 1's `EnrollmentManager.tsx` (`EnrollmentRow`, `toggleActive`, `removeEnrollment`, `saveQuotaOverride`, `load`, `quotaOverride`/`setQuotaOverride`, `ConfirmDialog` — all already defined there). Also consumes the existing `TutoringBookingCalendar` (`src/components/tutoring/TutoringBookingCalendar.tsx`) and `formatDateWithWeekday` (`src/lib/dateFormat.ts`), both unchanged.
- Produces: `AdminBookingModal({ enrollment: { id, studentId, studentName, programName, defaultDurationMinutes }, onClose, onBooked })` — a default export used only by this task's `EnrollmentManager.tsx`; no later task depends on it. `EnrollmentRow` gains `defaultDurationMinutes: number`.

- [ ] **Step 1: Create `AdminBookingModal.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';

interface MissedBookingOption {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface AdminBookingModalProps {
  enrollment: { id: string; studentId: string; studentName: string; programName: string; defaultDurationMinutes: number };
  onClose: () => void;
  onBooked: () => void;
}

export default function AdminBookingModal({ enrollment, onClose, onBooked }: AdminBookingModalProps) {
  const [kind, setKind] = useState<'regular' | 'makeup'>('regular');
  const [missedBookings, setMissedBookings] = useState<MissedBookingOption[]>([]);
  const [makeupOriginalId, setMakeupOriginalId] = useState('');

  useEffect(() => {
    if (kind !== 'makeup') {
      setMissedBookings([]);
      setMakeupOriginalId('');
      return;
    }
    setMakeupOriginalId('');
    fetch(`/api/tutoring-bookings/makeup-eligible?enrollmentId=${enrollment.id}`)
      .then((res) => res.json())
      .then(setMissedBookings);
  }, [kind, enrollment.id]);

  return (
    <Modal open onClose={onClose} title={`新增預約：${enrollment.studentName}・${enrollment.programName}`}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-inkMuted">
          類型
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'regular' | 'makeup')}
            className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
          >
            <option value="regular">一般</option>
            <option value="makeup">補課</option>
          </select>
        </label>
        {kind === 'makeup' && (
          <label className="text-xs text-inkMuted">
            要補的缺席紀錄
            <select
              value={makeupOriginalId}
              onChange={(e) => setMakeupOriginalId(e.target.value)}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              <option value="">請選擇</option>
              {missedBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatDateWithWeekday(b.date)}・{b.startTime}-{b.endTime}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {kind === 'makeup' && missedBookings.length === 0 && (
        <p className="text-sm text-inkMuted">這位學生目前沒有可補課的紀錄</p>
      )}
      {(kind === 'regular' || makeupOriginalId) && (
        <TutoringBookingCalendar
          key={`${kind}-${makeupOriginalId}`}
          enrollmentId={enrollment.id}
          defaultDurationMinutes={enrollment.defaultDurationMinutes}
          mode={kind}
          makeupForBookingId={kind === 'makeup' ? makeupOriginalId : undefined}
          successMessage={kind === 'makeup' ? '已建立補課預約' : '已新增預約'}
          onBooked={() => {
            onBooked();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Replace the full contents of `EnrollmentManager.tsx`**

```tsx
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
    const results = await Promise.all(
      selectedStudentIds.map(async (id) => {
        const res = await fetch('/api/tutoring-enrollments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: id, programId, monthlyQuota: quota }),
        });
        const name = students.find((s) => s.id === id)?.user.name ?? id;
        return { name, ok: res.ok };
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
    {
      header: '本月狀態',
      render: (r) => (
        <>
          已計次 {r.locked}／{r.monthlyQuota} 堂
          <br />
          <span className="text-xs text-inkMuted">（另 {r.upcoming} 堂待到）</span>
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
            {selectedStudentIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
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
          <Button onClick={createEnrollments}>新增報名</Button>
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
            <Button onClick={() => setBookingTarget(editingEnrollment)}>預約</Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await toggleActive(editingEnrollment);
                setEditingEnrollment(null);
              }}
            >
              {editingEnrollment.active ? '停用' : '啟用'}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await removeEnrollment(editingEnrollment);
                setEditingEnrollment(null);
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manually verify in the browser**

```bash
npm run dev
```

On `/admin/tutoring/bookings`, first click "取消（計次）" on one BOOKED row for a student you'll test with (this creates a `CANCELLED_LATE` record so there's a missed session to pick from in the 補課 test below). Then go to `/admin/tutoring`:

- Click "編輯" on any enrollment row. Confirm the Modal opens with 每月堂數覆寫 / 預約 / 停用 / 移除.
- Change the 每月堂數覆寫 value and click 儲存. Confirm the Modal stays open and the table's "本月狀態" 堂數 updates in the background (the Modal's own display doesn't need to reflect it live — that's expected).
- Click 停用. Confirm the Modal closes and the row's status flips to 已停用. Re-open 編輯 on the same row, click 啟用, confirm it flips back.
- Click 預約 on a row. Confirm `AdminBookingModal` opens stacked on top, titled "新增預約：<學生>・<課程>", defaulting to 一般. Pick a highlighted day on the calendar, choose a time, submit. Confirm the booking modal closes, toast reads "已新增預約", the outer 編輯 Modal is still open, and the row's "本月狀態" 堂數 updates. Confirm the new booking shows up on `/admin/tutoring/bookings`'s 當日預約總覽 for that date.
- Click 預約 again on the same row (outer Modal still open). Switch 類型 to 補課. Confirm the "要補的缺席紀錄" dropdown lists the `CANCELLED_LATE` record you created above. Pick it, choose a time on the calendar, submit. Confirm the toast reads "已建立補課預約" and the row's status reflects an already-booked makeup (auto-approved, not sitting in a pending queue).
- Click 編輯 → 移除 on any test row. Confirm the existing double-confirm dialog appears, and after confirming, the Modal closes and the row disappears from the table.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/tutoring/EnrollmentManager.tsx src/app/admin/tutoring/AdminBookingModal.tsx
git commit -m "feat(tutoring): merge quota-override/actions into a single Edit modal with nested booking"
```

---

### Task 3: `/admin/tutoring/bookings` 移除「新增預約」卡片

**Files:**
- Modify: `src/app/admin/tutoring/bookings/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: nothing from Task 1 or Task 2 — this file has no import relationship with `EnrollmentManager.tsx` or `AdminBookingModal.tsx`. Independent of the other two tasks.
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Replace the full contents of `bookings/page.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import DataTable from '@/components/ui/DataTable';
import ExportCsvButton from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface OverviewRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: string;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
}

interface SummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  cancelledLate: number;
  absent: number;
  makeup: number;
}

function todayDateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminTutoringBookingsPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [date, setDate] = useState(todayDateInput());
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [month, setMonth] = useState(todayDateInput().slice(0, 7));
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  async function loadOverview() {
    const res = await fetch(`/api/tutoring-bookings/overview?date=${date}`);
    setRows(await res.json());
  }

  async function loadSummary() {
    const res = await fetch(`/api/tutoring-bookings/monthly-summary?month=${month}`);
    setSummary(await res.json());
  }

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function cancel(row: OverviewRow, countsTowardQuota: boolean) {
    const message = countsTowardQuota ? '確定要取消並計入這位學生本月次數嗎？' : '確定要取消嗎？此次不計入學生次數。';
    if (!(await confirm(message, { danger: true }))) return;
    await fetch(`/api/tutoring-bookings/${row.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countsTowardQuota }),
    });
    showToast('已取消');
    loadOverview();
  }

  const columns: Column<OverviewRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '時間', render: (r) => `${r.startTime}-${r.endTime}` },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
    {
      header: '操作',
      render: (r) =>
        r.status === 'BOOKED' ? (
          <div className="flex flex-col gap-1">
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r, false)}>
              取消（不計次）
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r, true)}>
              取消（計次）
            </Button>
          </div>
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
  ];

  const summaryColumns: Column<SummaryRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '已上', render: (r) => r.attended },
    { header: '當天取消', render: (r) => r.cancelledLate },
    { header: '缺席', render: (r) => r.absent },
    { header: '補課', render: (r) => r.makeup },
  ];

  return (
    <>
      <Link
        href="/admin/tutoring"
        className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回個別輔導管理
      </Link>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約總覽</h1>

      <div className="mb-4 flex items-center gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <Card className="mb-6">
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} emptyText="這天沒有預約" />
      </Card>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-bold text-ink">當月出席總表</h2>
        <div className="flex items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <ExportCsvButton
            rows={summary}
            filename={`個別輔導出席總表_${month}`}
            columns={[
              { header: '學生', value: (r) => r.studentName },
              { header: '課程', value: (r) => r.programName },
              { header: '已上', value: (r) => r.attended },
              { header: '當天取消', value: (r) => r.cancelledLate },
              { header: '缺席', value: (r) => r.absent },
              { header: '補課', value: (r) => r.makeup },
            ]}
          />
        </div>
      </div>
      <Card>
        <DataTable columns={summaryColumns} rows={summary} keyField={(r) => r.enrollmentId} emptyText="這個月沒有資料" />
      </Card>
      {ConfirmDialog}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manually verify in the browser**

```bash
npm run dev
```

Go to `/admin/tutoring/bookings`. Confirm the "新增預約" card is gone. Confirm 當日預約總覽表 still loads and its 取消（不計次）/取消（計次）buttons still work, the date picker still switches days, 當月出席總表 still loads with a working month picker and CSV export, and 返回個別輔導管理 still navigates back to `/admin/tutoring`.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/tutoring/bookings/page.tsx
git commit -m "refactor(tutoring): remove now-redundant 新增預約 card from bookings overview"
```
