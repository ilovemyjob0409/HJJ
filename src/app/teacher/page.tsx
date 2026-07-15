import Link from 'next/link';

export default function TeacherDashboard() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">老師首頁</h1>
      <nav className="flex flex-col gap-2">
        <Link className="underline" href="/teacher/leave-request">請假/調課申請</Link>
        <Link className="underline" href="/teacher/availability">設定我的可補課時段</Link>
      </nav>
    </div>
  );
}
