'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import WeeklyTimetableGrid from '@/components/timetable/WeeklyTimetableGrid';

export default function StudentTimetablePage() {
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/subject-colors')
      .then((res) => res.json())
      .then((rows: { subject: string; color: string }[]) => {
        setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color])));
      });
  }, []);

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">週課表</h1>
      <Card>
        <WeeklyTimetableGrid colors={colors} />
      </Card>
    </>
  );
}
