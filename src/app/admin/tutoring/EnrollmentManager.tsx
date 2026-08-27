'use client';

import { useEffect, useRef, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import DataTable, { Column } from '@/components/ui/DataTable';
import CollapsibleSearchInput from '@/components/ui/CollapsibleSearchInput';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge, { getStatusBadgeConfig } from '@/components/ui/StatusBadge';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { attendanceDisplayStatus } from '@/lib/attendanceDisplay';
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

interface AttendanceRecord {
  id: string;
  date: string;
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
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
  const [listSearch, setListSearch] = useState('');
  const [programId, setProgramId] = useState('');
  const [newMonthlyQuota, setNewMonthlyQuota] = useState('');
  const [quotaOverride, setQuotaOverride] = useState<Record<string, string>>({});
  const [editingEnrollment, setEditingEnrollment] = useState<EnrollmentRow | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[] | null>(null);
  const [attendanceRefreshKey, setAttendanceRefreshKey] = useState(0); // 彈窗內預約成功後刷新出缺勤表格
  const [addOpen, setAddOpen] = useState(false);
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

  // 編輯彈窗開啟時載入該報名的完整出缺勤；null = 載入中（表格顯示骨架屏）
  // cancelled flag：快速切換不同報名時，丟棄前一筆已過期的回應。
  const editingEnrollmentId = editingEnrollment?.id ?? null;
  useEffect(() => {
    setAttendanceRecords(null);
    if (!editingEnrollmentId) return;
    let cancelled = false;
    fetch(`/api/tutoring-enrollments/${editingEnrollmentId}/attendance`)
      .then((res) => {
        if (!res.ok) throw new Error('LOAD_FAILED');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setAttendanceRecords(data.records);
      })
      .catch(() => {
        if (!cancelled) {
          showToast('出缺勤紀錄載入失敗');
          setAttendanceRecords([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingEnrollmentId, attendanceRefreshKey]);

  // 深連結：/admin/tutoring?student=<id>（學生名單「前往管理」）——
  // 報名載入後把清單篩到該學生；只有一筆報名就直接開編輯彈窗。
  // 只在第一次載入時處理，之後的 load()（增刪改後重抓）不再觸發。
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || enrollments.length === 0) return;
    deepLinkHandledRef.current = true;
    const studentId = new URLSearchParams(window.location.search).get('student');
    if (!studentId) return;
    const rows = enrollments.filter((r) => r.studentId === studentId);
    if (rows.length === 0) return;
    setListSearch(rows[0].studentName);
    if (rows.length === 1) setEditingEnrollment(rows[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollments]);

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
        setAddOpen(false);
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

  const q = listSearch.trim().toLowerCase();
  const filteredEnrollments = q
    ? enrollments.filter((r) => r.studentName.toLowerCase().includes(q) || r.programName.toLowerCase().includes(q))
    : enrollments;

  const columns: Column<EnrollmentRow>[] = [
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    {
      header: '本月狀態',
      render: (r) => (
        <>
          已計次 {r.locked}／{r.monthlyQuota} 堂
          <br />
          <span className="text-xs text-inkMuted">（已預約 {r.upcoming} 堂）</span>
          {!r.active && (
            <>
              <br />
              <span className="text-xs text-rejected">（已停用）</span>
            </>
          )}
        </>
      ),
    },
  ];

  const attendanceColumns: Column<AttendanceRecord>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    {
      header: '狀態',
      render: (r) => <StatusBadge status={attendanceDisplayStatus(r.attendanceStatus, r.bookingStatus)} />,
      sortValue: (r) => attendanceDisplayStatus(r.attendanceStatus, r.bookingStatus),
    },
    { header: '類型', render: (r) => (r.isMakeup ? '補課' : '一般'), sortValue: (r) => (r.isMakeup ? 1 : 0) },
    { header: '簽到', render: (r) => r.checkInTime ?? '-', sortValue: (r) => r.checkInTime ?? null },
    { header: '簽退', render: (r) => r.checkOutTime ?? '-', sortValue: (r) => r.checkOutTime ?? null },
  ];

  // 匯出欄位：畫面欄位是 React 節點，匯出要另外給純文字（ExportExcelButton 慣例）
  const attendanceExportColumns = [
    { header: '日期', value: (r: AttendanceRecord) => formatDateWithWeekday(r.date) },
    { header: '狀態', value: (r: AttendanceRecord) => getStatusBadgeConfig(attendanceDisplayStatus(r.attendanceStatus, r.bookingStatus)).label },
    { header: '類型', value: (r: AttendanceRecord) => (r.isMakeup ? '補課' : '一般') },
    { header: '簽到', value: (r: AttendanceRecord) => r.checkInTime ?? '' },
    { header: '簽退', value: (r: AttendanceRecord) => r.checkOutTime ?? '' },
  ];

  // 彈窗內容一律用清單裡的最新資料：editingEnrollment 是點列當下的快照，
  // 彈窗內預約／儲存覆寫後 load() 只會刷新 enrollments，快照不會跟著動。
  const editingRow = editingEnrollment ? (enrollments.find((e) => e.id === editingEnrollment.id) ?? editingEnrollment) : null;

  return (
    <>
      <div className="mb-2 mt-6 flex items-center gap-3">
        <h2 className="shrink-0 whitespace-nowrap font-bold text-ink">學生報名管理</h2>
        <CollapsibleSearchInput placeholder="搜尋學生或課程" value={listSearch} onChange={setListSearch} />
      </div>
      {!addOpen ? (
        <div className="mb-4">
          <Button onClick={() => setAddOpen(true)}>＋ 新增報名</Button>
        </div>
      ) : (
      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-ink">新增報名</p>
          <Button variant="link" tone="muted" className="text-xs" onClick={() => setAddOpen(false)}>
            收合
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {/* 這裡刻意用 div 不用 label：label 會把點擊轉發給第一個表單控件，
              Safari 連點在按鈕上也照轉——選完學生後第一個控件變成 chip 的 ✕，
              等於一點選就立刻被移除（Chromium 沒這行為，只有 Safari 會踩到）。 */}
          <div className="text-xs text-inkMuted">
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
              <div className="flex h-9 items-center gap-1.5 rounded-lg border border-borderSubtle bg-card px-2">
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
                  aria-label="搜尋學生姓名"
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
          </div>
          <label className="text-xs text-inkMuted">
            課程
            <Select value={programId} onChange={(e) => setProgramId(e.target.value)} className="mt-1 block">
              <option value="">請選擇</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-inkMuted">
            每月堂數
            <input
              type="number"
              min={0}
              placeholder="預設"
              value={newMonthlyQuota}
              onChange={(e) => setNewMonthlyQuota(e.target.value)}
              className="mt-1 block h-9 w-20 rounded-lg border border-borderSubtle bg-card px-2 text-sm text-ink"
            />
          </label>
          <Button onClick={createEnrollments} loading={submitting}>新增報名</Button>
        </div>
      </Card>
      )}
      <Card>
        <DataTable
          columns={columns}
          rows={filteredEnrollments}
          keyField={(r) => r.id}
          onRowClick={(r) => setEditingEnrollment(r)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          emptyText={listSearch.trim() ? '沒有符合搜尋的學生' : '目前沒有學生報名個別輔導'}
        />
      </Card>
      <Modal
        open={editingRow !== null}
        onClose={() => setEditingEnrollment(null)}
        title={`${editingRow?.studentName ?? ''}・${editingRow?.programName ?? ''}`}
        maxWidthClassName="max-w-4xl"
      >
        {editingRow && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-stripe p-3">
                <p className="text-xs font-medium text-inkMuted">本月狀態</p>
                <p className="mt-1 text-lg font-bold text-ink">
                  已計次 {editingRow.locked}／{editingRow.monthlyQuota} 堂
                </p>
                <p className="text-xs text-inkMuted">（已預約 {editingRow.upcoming} 堂）</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-inkMuted">每月堂數覆寫</p>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    placeholder="預設"
                    value={quotaOverride[editingRow.id] ?? ''}
                    onChange={(e) => setQuotaOverride((prev) => ({ ...prev, [editingRow.id]: e.target.value }))}
                    className="w-20 py-1 text-sm"
                  />
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => saveQuotaOverride(editingRow)}>
                    儲存
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {editingRow.active ? (
                  <Button onClick={() => setBookingTarget(editingRow)}>預約</Button>
                ) : (
                  <p className="text-xs text-inkMuted">已停用，請先啟用才能預約</p>
                )}
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (await toggleActive(editingRow)) setEditingEnrollment(null);
                  }}
                >
                  {editingRow.active ? '停用' : '啟用'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (await removeEnrollment(editingRow)) setEditingEnrollment(null);
                  }}
                >
                  移除
                </Button>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium text-inkMuted">出缺勤紀錄</p>
                <ExportExcelButton
                  rows={attendanceRecords ?? []}
                  columns={attendanceExportColumns}
                  filename={`個別輔導出缺勤_${editingRow.studentName}_${editingRow.programName}`}
                  className="px-2 py-1 text-xs"
                />
              </div>
              <CollapsibleDataTable
                columns={attendanceColumns}
                rows={attendanceRecords ?? []}
                loading={attendanceRecords === null}
                keyField={(r) => r.id}
                maxRows={3}
                emptyText="尚無出缺勤紀錄"
              />
            </div>
          </div>
        )}
      </Modal>
      {bookingTarget && (
        <AdminBookingModal
          enrollment={bookingTarget}
          onClose={() => setBookingTarget(null)}
          onBooked={() => {
            load();
            setAttendanceRefreshKey((k) => k + 1);
          }}
        />
      )}
      {ConfirmDialog}
    </>
  );
}
