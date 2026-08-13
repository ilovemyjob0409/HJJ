import ClassAttendanceOverview from '@/components/ClassAttendanceOverview';

export default function TeacherClassAttendancePage({ params }: { params: { id: string } }) {
  return <ClassAttendanceOverview classId={params.id} backHref="/teacher" backLabel="返回首頁" />;
}
