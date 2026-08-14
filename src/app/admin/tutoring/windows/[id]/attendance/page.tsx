import TutoringWindowAttendanceOverview from '@/components/TutoringWindowAttendanceOverview';

export default function AdminTutoringWindowAttendancePage({ params }: { params: { id: string } }) {
  return <TutoringWindowAttendanceOverview windowId={params.id} backHref="/admin/tutoring" backLabel="返回個別輔導管理" />;
}
