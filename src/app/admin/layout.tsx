import AppShell from '@/components/ui/AppShell';
import { MobileTableLayoutProvider } from '@/components/ui/mobileTableLayout';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="ADMIN">
      <MobileTableLayoutProvider value="table">{children}</MobileTableLayoutProvider>
    </AppShell>
  );
}
