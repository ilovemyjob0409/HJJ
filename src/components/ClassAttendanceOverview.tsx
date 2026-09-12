'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AlertModal from '@/components/ui/AlertModal';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

interface MatrixCell {
  kind: 'PRESENT' | 'ON_LEAVE' | 'MAKEUP' | 'ABSENT' | 'NOT_REGISTERED' | 'UNMARKED';
  makeupDate: string | null;
  makeupPending: boolean;
}

interface MatrixStudent {
  studentId: string;
  studentName: string;
  cells: Record<string, MatrixCell>;
}

interface OverviewResponse {
  class: {
    id: string;
    name: string;
    subject: string;
    level: string;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherName: string;
  };
  dates: string[];
  students: MatrixStudent[];
}

// 'YYYY-MM-DD' → 「9/10（三）」；矩陣欄頭空間小，用短月日仍維持日期（星期）慣例。
function formatShortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${m}/${d}（${WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

function formatShortMonthDay(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

const CELL_BADGE: Record<Exclude<MatrixCell['kind'], 'ON_LEAVE'>, { label: string; className: string }> = {
  PRESENT: { label: '簽到', className: 'bg-approvedBg text-approved' },
  MAKEUP: { label: '補課', className: 'bg-pendingBg text-pending' },
  ABSENT: { label: '缺席', className: 'bg-rejectedBg text-rejected' },
  NOT_REGISTERED: { label: '未報名', className: 'bg-borderSubtle text-inkMuted' },
  UNMARKED: { label: '未點名', className: 'text-inkMuted' },
};

function MatrixCellContent({ cell }: { cell: MatrixCell | undefined }) {
  // 沒有格子＝該生該日與本班無關（插班／已退班學生的其他日期），留空。
  if (!cell) return <span className="text-inkMuted/50">—</span>;
  if (cell.kind === 'ON_LEAVE') {
    return (
      <span className="inline-flex flex-col items-center gap-0.5">
        <span className="inline-block whitespace-nowrap rounded-full bg-assignedBg px-2 py-0.5 text-xs font-semibold text-assigned">請假</span>
        {cell.makeupDate !== null && (
          <span
            className={`whitespace-nowrap text-xs ${cell.makeupPending ? 'text-pending' : 'text-approved'}`}
            title={cell.makeupPending ? '補課待審核' : '補課已核准'}
          >
            補於{formatShortMonthDay(cell.makeupDate)}
          </span>
        )}
      </span>
    );
  }
  const { label, className } = CELL_BADGE[cell.kind];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

// Excel 匯出用的純文字格值（畫面徽章的文字版）；插班／已退班學生的無關日期留空。
function exportCellText(cell: MatrixCell | undefined): string {
  if (!cell) return '';
  if (cell.kind === 'ON_LEAVE') {
    if (cell.makeupDate === null) return '請假';
    const md = formatShortMonthDay(cell.makeupDate);
    return cell.makeupPending ? `請假（補於${md}・待審）` : `請假（補於${md}）`;
  }
  return CELL_BADGE[cell.kind].label;
}

// 整班出缺勤總表（矩陣式）：橫軸＝近三個月該班上課日（新→舊）、縱軸＝學生，
// 每格一種標籤（簽到／請假＋補於日期／補課／未點名，缺席與未報名照實顯示）。
// 學生姓名欄 sticky 固定在左側，表格本體橫向捲動（手機同樣橫捲）。老師／行政
// 共用同一個元件，權限與範圍差異都在 API 層
// （見 /api/classes/[id]/attendance-overview），這裡只負責顯示。
// canBackfill（行政頁限定）：按「補登」進入補登模式後，「未點名」格子才換
// 成核取方塊（平常保持乾淨，同批量處理模式慣例）；勾選當下即補登為「出席」
// （不帶時間），成功後格子直接變成簽到——已是簽到就不能在這裡反悔，要改得
// 走點名頁。
export default function ClassAttendanceOverview({
  classId,
  backHref,
  backLabel,
  canBackfill = false,
}: {
  classId: string;
  backHref: string;
  backLabel: string;
  canBackfill?: boolean;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfillMode, setBackfillMode] = useState(false); // 補登模式：開啟才把「未點名」格換成核取方塊（同批量處理模式慣例）
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());
  const [backfillError, setBackfillError] = useState(false);

  useEffect(() => {
    fetch(`/api/classes/${classId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [classId]);

  const handleBackfill = useCallback(
    async (studentId: string, date: string) => {
      const cellKey = `${studentId}|${date}`;
      setPendingCells((prev) => new Set(prev).add(cellKey));
      try {
        const res = await fetch(`/api/classes/${classId}/attendance-backfill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ studentId, date }] }),
        });
        if (!res.ok) throw new Error('BACKFILL_FAILED');
        setData((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                students: prev.students.map((s) =>
                  s.studentId === studentId
                    ? { ...s, cells: { ...s.cells, [date]: { kind: 'PRESENT', makeupDate: null, makeupPending: false } } }
                    : s
                ),
              }
        );
      } catch {
        setBackfillError(true);
      } finally {
        setPendingCells((prev) => {
          const next = new Set(prev);
          next.delete(cellKey);
          return next;
        });
      }
    },
    [classId]
  );

  const exportColumns = data
    ? [
        { header: '學生', value: (s: MatrixStudent) => s.studentName },
        ...data.dates.map((key) => ({ header: formatShortDate(key), value: (s: MatrixStudent) => exportCellText(s.cells[key]) })),
      ]
    : [];

  return (
    <>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {backLabel}
      </Link>
      {loading ? (
        <p className="text-sm text-inkMuted">載入中…</p>
      ) : !data ? (
        <p className="text-sm text-inkMuted">找不到班級或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">{data.class.name}・出缺勤總表</h1>
          <p className="mb-4 text-sm text-inkMuted">
            {data.class.subject}・{data.class.level}｜週{WEEKDAY_LABELS[data.class.weekday]} {data.class.startTime}-{data.class.endTime}｜
            {data.class.teacherName}
          </p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有學生</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                {canBackfill && backfillMode && (
                  <p className="text-xs text-inkMuted">「未點名」格子可勾選，勾選後立即補登為出席（不帶時間）</p>
                )}
                <div className="ml-auto flex shrink-0 gap-2">
                  {canBackfill && (
                    <Button variant="secondary" onClick={() => setBackfillMode((v) => !v)}>
                      {backfillMode ? '結束補登' : '補登'}
                    </Button>
                  )}
                  <ExportExcelButton rows={data.students} columns={exportColumns} filename={`出缺勤總表_${data.class.name}`} />
                </div>
              </div>
              <Card className="p-0">
                <div className="overflow-x-auto rounded-xl">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-borderSubtle">
                        <th className="sticky left-0 z-10 border-r border-borderSubtle bg-card px-4 py-2.5 text-left font-semibold text-inkMuted">學生</th>
                        {data.dates.map((key) => (
                          <th key={key} className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold text-inkMuted">
                            {formatShortDate(key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.students.map((s) => (
                        <tr key={s.studentId} className="border-b border-borderSubtle last:border-b-0">
                          <td className="sticky left-0 z-10 whitespace-nowrap border-r border-borderSubtle bg-card px-4 py-2.5 font-semibold text-ink">{s.studentName}</td>
                          {data.dates.map((key) => {
                            const cell = s.cells[key];
                            return (
                              <td key={key} className="px-3 py-2.5 text-center">
                                {canBackfill && backfillMode && cell?.kind === 'UNMARKED' ? (
                                  <input
                                    type="checkbox"
                                    aria-label={`補登 ${s.studentName} ${formatShortDate(key)} 為出席`}
                                    title="勾選後立即補登為出席"
                                    checked={pendingCells.has(`${s.studentId}|${key}`)}
                                    disabled={pendingCells.has(`${s.studentId}|${key}`)}
                                    onChange={() => handleBackfill(s.studentId, key)}
                                  />
                                ) : (
                                  <MatrixCellContent cell={cell} />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
      <AlertModal open={backfillError} onClose={() => setBackfillError(false)} title="補登失敗">
        這一格沒有補登成功，可能是連線問題或資料已變動，請重新整理頁面後再試一次。
      </AlertModal>
    </>
  );
}
