import TutoringWindowAttendanceOverview from '@/components/TutoringWindowAttendanceOverview';

export default function TeacherTutoringWindowAttendancePage({ params }: { params: { id: string } }) {
  return <TutoringWindowAttendanceOverview windowId={params.id} backHref="/teacher" backLabel="返回首頁" />;
}
