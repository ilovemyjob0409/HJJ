import Link from 'next/link';

export default function StudentDashboard() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">學生首頁</h1>
      <nav className="flex flex-col gap-2">
        <Link className="underline" href="/student/leave-request">請假申請與紀錄</Link>
        <Link className="underline" href="/student/makeup-request">申請補課</Link>
      </nav>
    </div>
  );
}
