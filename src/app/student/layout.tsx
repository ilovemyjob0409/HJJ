import AppShell from '@/components/ui/AppShell';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="STUDENT">{children}</AppShell>;
}
