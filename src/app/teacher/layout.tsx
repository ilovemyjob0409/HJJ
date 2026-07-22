import AppShell from '@/components/ui/AppShell';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="TEACHER">{children}</AppShell>;
}
