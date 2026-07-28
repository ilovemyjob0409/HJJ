'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const NAV_LINKS: Record<Role, { href: string; label: string; exact?: boolean }[]> = {
  ADMIN: [
    { href: '/admin', label: '首頁', exact: true },
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
    { href: '/admin/attendance', label: '點名' },
    { href: '/admin/go-hall', label: '弈廳' },
    { href: '/admin/activities', label: '活動專區' },
  ],
  TEACHER: [
    { href: '/teacher', label: '首頁', exact: true },
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
    { href: '/teacher/attendance', label: '點名' },
    { href: '/teacher/activities', label: '活動專區' },
  ],
  STUDENT: [
    { href: '/student', label: '首頁', exact: true },
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/go-hall', label: '弈廳' },
    { href: '/student/attendance', label: '我的出席紀錄' },
    { href: '/student/activities', label: '活動專區' },
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPositionedRef = useRef(false);

  useLayoutEffect(() => {
    const positionIndicator = () => {
      const indicator = indicatorRef.current;
      const activeLink = activeLinkRef.current;
      if (!indicator) return;
      if (!activeLink) {
        indicator.style.opacity = '0';
        return;
      }
      indicator.style.opacity = '1';
      indicator.style.width = `${activeLink.offsetWidth}px`;
      indicator.style.transform = `translateX(${activeLink.offsetLeft}px)`;
      if (!indicatorPositionedRef.current) {
        // Snap into place on first mount instead of sliding in from the edge.
        indicator.style.transitionDuration = '0s';
        requestAnimationFrame(() => {
          indicator.style.transitionDuration = '';
        });
        indicatorPositionedRef.current = true;
      }
    };
    positionIndicator();
    // Webfont subsets stream in after first paint and shift link geometry,
    // so track the links themselves instead of a one-shot fonts.ready.
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(positionIndicator);
    container.querySelectorAll('a').forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (activeLinkRef.current) {
      activeLinkRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } else if (scrollContainerRef.current) {
      // No tab is active (e.g. the dashboard home) — center the pill list's
      // scroll position instead of leaving it flush at the start, since
      // justify-center has no effect once the list overflows its container.
      const el = scrollContainerRef.current;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    }
  }, [pathname]);

  return (
    <div className="min-h-screen bg-cream/40">
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-borderSubtle bg-card px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
        <Link href={HOME_HREF[role]} className="flex cursor-pointer items-center">
          <Logo className="h-6 w-auto sm:h-8" />
        </Link>
        <nav className="flex min-w-0 justify-center text-xs sm:text-sm">
          <div
            ref={scrollContainerRef}
            className="scrollbar-hide relative flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-full bg-cream p-0.5 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)] sm:p-1"
          >
            <span
              ref={indicatorRef}
              className="pointer-events-none absolute bottom-0.5 top-0.5 left-0 rounded-full bg-brand opacity-0 shadow-sm transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:bottom-1 sm:top-1"
            />
            {NAV_LINKS[role].map((link) => {
              // Home links use exact match — every route under the role shares their prefix.
              const active = link.exact
                ? pathname === link.href
                : pathname === link.href || pathname?.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  ref={active ? activeLinkRef : undefined}
                  className={`relative z-10 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1 font-semibold transition-colors sm:px-4 sm:py-1.5 ${
                    active ? 'text-brandInk' : 'text-inkMuted hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="flex shrink-0 items-center justify-self-end gap-1 sm:gap-2">
          <ThemeToggle />
          <button onClick={() => signOut()} className="cursor-pointer text-xs text-inkMuted hover:text-ink sm:text-sm">
            登出
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <div key={pathname ?? ''} className="animate-rise-in">
          {children}
        </div>
      </main>
    </div>
  );
}
