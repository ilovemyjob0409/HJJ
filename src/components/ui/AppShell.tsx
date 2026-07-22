'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { ReactNode } from 'react';
import Logo from './Logo';

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
  return (
    <div className="min-h-screen bg-cream/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-3">
        <Link href={HOME_HREF[role]} className="flex cursor-pointer items-center gap-2 font-bold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand">
            <Logo size={20} />
          </span>
          補習班補課系統
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-ink">
          {NAV_LINKS[role].map((link) => (
            <Link key={link.href} href={link.href} className="cursor-pointer hover:text-brandDark">
              {link.label}
            </Link>
          ))}
          <button onClick={() => signOut()} className="cursor-pointer text-inkMuted hover:text-ink">
            登出
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
