import AppShell from '@/components/ui/AppShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="ADMIN">{children}</AppShell>;
}
