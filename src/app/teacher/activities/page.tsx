'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import ActivityDetail from '@/components/ActivityDetail';
import ActivityCardGrid from '@/components/ActivityCardGrid';

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  coverUrl: string | null;
  title: string;
  description: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
  registrations: RosterEntry[];
  _count: { registrations: number };
}

export default function TeacherActivitiesPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [viewing, setViewing] = useState<ActivityRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/activities')
      .then((res) => res.json())
      .then(setActivities)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">帶領的活動</h1>
      <ActivityCardGrid
        activities={activities}
        loading={loading}
        emptyText="目前沒有帶領的活動"
        onView={(a) => setViewing(a)}
      />

      <Modal open={viewing !== null} onClose={() => setViewing(null)} flush maxWidthClassName="max-w-xl">
        {viewing && <ActivityDetail key={viewing.id} activity={viewing} onClose={() => setViewing(null)} />}
      </Modal>
    </>
  );
}
