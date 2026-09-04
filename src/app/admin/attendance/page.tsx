'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import AttendanceHub, { todayDateInput } from '@/components/AttendanceHub';
import { hasDate, rowsFromResponse } from '@/components/attendanceHubFetch';

interface ClassOption {
  id: string;
  name: string;
}

interface StudentOption {
  id: string;
  user: { name: string };
}

const STATUS_LABELS: { key: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED'; label: string }[] = [
  { key: 'PRESENT', label: '出席' },
  { key: 'LATE', label: '遲到' },
  { key: 'LEFT_EARLY', label: '早退' },
  { key: 'ON_LEAVE', label: '請假' },
  { key: 'NOT_REGISTERED', label: '未報名' },
  { key: 'ABSENT', label: '缺席未請假' },
];

function AttendanceStatsPanel() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(todayDateInput());
  const [to, setTo] = useState(todayDateInput());
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch('/api/classes').then(async (r) => {
      const rows = rowsFromResponse<ClassOption>(r.ok, await r.json());
      if (rows) setClasses(rows);
    });
    fetch('/api/students').then(async (r) => {
      const rows = rowsFromResponse<StudentOption>(r.ok, await r.json());
      if (rows) setStudents(rows);
    });
  }, []);

  async function runQuery() {
    if (!hasDate(from) || !hasDate(to)) return; // 日期欄可被鍵盤清空；缺日期不查詢，保留原結果
    const params = new URLSearchParams({ from, to });
    if (studentId) params.set('studentId', studentId);
    if (classId) params.set('classId', classId);
    const res = await fetch(`/api/attendance/stats?${params.toString()}`);
    const data = await res.json();
    setCounts(data.counts);
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">全部學生</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.user.name}
            </option>
          ))}
        </Select>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">全部班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button onClick={runQuery}>查詢</Button>
      </div>
      {counts && (
        <ul className="flex flex-col gap-1 text-sm text-ink">
          {STATUS_LABELS.map(({ key, label }) => (
            <li key={key}>
              {label}：{counts[key]}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminAttendancePage() {
  const [tab, setTab] = useState<'roll' | 'stats'>('roll');

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">點名</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant={tab === 'roll' ? 'primary' : 'secondary'} onClick={() => setTab('roll')}>
          點名總覽
        </Button>
        <Button variant={tab === 'stats' ? 'primary' : 'secondary'} onClick={() => setTab('stats')}>
          統計
        </Button>
        <Link href="/admin/attendance/checkin" className="ml-auto">
          <Button variant="secondary">櫃檯報到模式</Button>
        </Link>
      </div>
      {tab === 'roll' ? <AttendanceHub /> : <AttendanceStatsPanel />}
    </>
  );
}
