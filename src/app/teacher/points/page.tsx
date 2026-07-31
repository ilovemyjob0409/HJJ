import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import AwardPointsForm from './AwardPointsForm';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every teacher until the next deploy.
export const dynamic = 'force-dynamic';

export default async function TeacherPointsPage() {
  const session = await getServerSession(authOptions);
  const teacher = session ? await prisma.teacher.findUnique({ where: { userId: session.user.id } }) : null;
  const classes = teacher
    ? await prisma.class.findMany({
        where: { teacherId: teacher.id },
        select: {
          id: true,
          name: true,
          enrollments: {
            select: { student: { select: { id: true, user: { select: { name: true } } } } },
            orderBy: { student: { user: { name: 'asc' } } },
          },
        },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      })
    : [];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">給點</h1>
      <AwardPointsForm classes={classes} />
    </>
  );
}
