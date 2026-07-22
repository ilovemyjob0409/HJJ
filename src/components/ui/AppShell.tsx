'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ReactNode } from 'react';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const NAV_LINKS: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
  ],
  TEACHER: [
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
  ],
  STUDENT: [
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
  ],
};

const HOME_HREF: Record<Role, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
};

export default function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-cream/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-3">
        <Link href={HOME_HREF[role]} className="flex cursor-pointer items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="MUP" className="h-8 w-auto" />
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-3 text-sm sm:flex-none">
          <div className="scrollbar-hide flex min-w-0 gap-0.5 overflow-x-auto rounded-full bg-cream p-1">
            {NAV_LINKS[role].map((link) => {
              const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 font-semibold transition-colors ${
                    active ? 'bg-brand text-ink shadow-sm' : 'text-inkMuted hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
          <button onClick={() => signOut()} className="shrink-0 cursor-pointer text-inkMuted hover:text-ink">
            登出
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
