import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hasActiveClassEnrollment } from '@/lib/services/classService';
import AppShell from '@/components/ui/AppShell';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const student = session
    ? await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } })
    : null;
  // 查不到學生（未登入等，middleware 會導走）時維持預設顯示，不誤藏。
  const hasClassEnrollment = student ? await hasActiveClassEnrollment(student.id) : true;
  return (
    <AppShell role="STUDENT" hasClassEnrollment={hasClassEnrollment}>
      {children}
    </AppShell>
  );
}
