import ClassAttendanceOverview from '@/components/ClassAttendanceOverview';

export default function AdminClassAttendancePage({ params }: { params: { id: string } }) {
  return <ClassAttendanceOverview classId={params.id} backHref="/admin/classes" backLabel="返回班級名單" />;
}
