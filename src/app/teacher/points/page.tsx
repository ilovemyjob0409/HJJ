import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ClassAwardTable from '@/components/ClassAwardTable';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every teacher until the next deploy.
export const dynamic = 'force-dynamic';

export default async function TeacherPointsPage() {
  const session = await getServerSession(authOptions);
  const teacher = session ? await prisma.teacher.findUnique({ where: { userId: session.user.id } }) : null;
  // 老師只拿得到自己任教的班級——加分頁的班級搜尋因此天然只搜得到自己的班。
  const classes = teacher
    ? await prisma.class.findMany({
        where: { teacherId: teacher.id },
        select: {
          id: true,
          name: true,
          subject: true,
          enrollments: {
            select: { student: { select: { id: true, user: { select: { name: true } } } } },
            orderBy: { student: { user: { name: 'asc' } } },
          },
        },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      })
    : [];

  const awardClasses = classes.map((c) => ({
    id: c.id,
    name: c.name,
    subject: c.subject,
    students: c.enrollments.map((e) => ({ id: e.student.id, name: e.student.user.name })),
  }));

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">給點</h1>
      <ClassAwardTable classes={awardClasses} />
    </>
  );
}
