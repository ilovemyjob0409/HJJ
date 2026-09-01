import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listTeacherAwardClasses } from '@/lib/services/pointService';
import ClassAwardTable from '@/components/ClassAwardTable';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every teacher until the next deploy.
export const dynamic = 'force-dynamic';

export default async function TeacherPointsPage() {
  const session = await getServerSession(authOptions);
  const teacher = session ? await prisma.teacher.findUnique({ where: { userId: session.user.id } }) : null;
  // 老師只拿得到自己任教的班級與個輔方案——加分頁的搜尋因此天然只搜得到自己的班。
  const awardClasses = teacher ? await listTeacherAwardClasses(teacher.id) : [];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">給點</h1>
      <ClassAwardTable classes={awardClasses} />
    </>
  );
}
