'use client';

import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';
import type { TeacherTutoringWindowSummary } from '@/lib/services/tutoringProgramService';

export default function TeacherTutoringWindowList({ windows }: { windows: TeacherTutoringWindowSummary[] }) {
  const router = useRouter();

  const columns: Column<TeacherTutoringWindowSummary>[] = [
    { header: '課程', render: (w) => w.programName },
    { header: '時段', render: (w) => `週${WEEKDAY_LABELS[w.weekday]} ${w.startTime}-${w.endTime}` },
  ];

  return (
    <Card className="mb-6">
      {windows.length === 0 ? (
        <p className="text-sm text-inkMuted">目前沒有個別輔導時段</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={windows}
            keyField={(w) => w.id}
            onRowClick={(w) => router.push(`/teacher/tutoring/windows/${w.id}/attendance`)}
            rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          />
          <p className="mt-2 text-xs text-inkMuted">點任一列查看該時段出缺勤總表</p>
        </>
      )}
    </Card>
  );
}
