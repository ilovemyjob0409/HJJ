'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ReactNode, useEffect, useRef } from 'react';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const NAV_LINKS: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
    { href: '/admin/go-hall', label: '弈廳' },
  ],
  TEACHER: [
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
  ],
  STUDENT: [
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/go-hall', label: '弈廳' },
  ],
};

const HOME_HREF: Record<Role, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
};

export default function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const pathname = usePathname();
  const activeLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <div className="min-h-screen bg-cream/40">
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-gray-100 bg-white px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
        <Link href={HOME_HREF[role]} className="flex cursor-pointer items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="MUP" className="h-6 w-auto sm:h-8" />
        </Link>
        <nav className="flex min-w-0 justify-center text-xs sm:text-sm">
          <div className="scrollbar-hide flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-full bg-cream p-0.5 sm:p-1">
            {NAV_LINKS[role].map((link) => {
              const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  ref={active ? activeLinkRef : undefined}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1 font-semibold transition-colors sm:px-4 sm:py-1.5 ${
                    active ? 'bg-brand text-ink shadow-sm' : 'text-inkMuted hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <button
          onClick={() => signOut()}
          className="shrink-0 cursor-pointer justify-self-end text-xs text-inkMuted hover:text-ink sm:text-sm"
        >
          登出
        </button>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
