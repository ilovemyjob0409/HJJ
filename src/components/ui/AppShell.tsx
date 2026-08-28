'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signIn, signOut } from 'next-auth/react';
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Logo from './Logo';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import { useToast } from './Toast';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const NAV_LINKS: Record<Role, { href: string; label: string; exact?: boolean }[]> = {
  ADMIN: [
    { href: '/admin', label: '首頁', exact: true },
    { href: '/admin/attendance', label: '點名' },
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/tutoring', label: '個別輔導' },
    { href: '/admin/makeup-requests', label: '請假管理' },
    { href: '/admin/billing', label: '收費' },
    { href: '/admin/substitute-requests', label: '代課安排' },
    { href: '/admin/go-hall', label: '弈廳' },
    { href: '/admin/activities', label: '活動專區' },
    { href: '/admin/points', label: '集點' },
    { href: '/admin/makeup-notices', label: '補課須知' },
    { href: '/admin/faq', label: '常見問題' },
  ],
  TEACHER: [
    { href: '/teacher', label: '首頁', exact: true },
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
    { href: '/teacher/attendance', label: '點名' },
    { href: '/teacher/points', label: '給點' },
    { href: '/teacher/activities', label: '活動專區' },
  ],
  STUDENT: [
    { href: '/student', label: '首頁', exact: true },
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/tutoring', label: 'MPM&PLUS' },
    { href: '/student/timetable', label: '週課表' },
    { href: '/student/go-hall', label: '弈廳' },
    { href: '/student/attendance', label: '我的出席紀錄' },
    { href: '/student/points', label: '集點卡' },
    { href: '/student/activities', label: '活動專區' },
    { href: '/student/faq', label: '常見問題' },
  ],
};

const HOME_HREF: Record<Role, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
};

// 這些入口只對「仍有有效班級報名」的學生顯示——純個別輔導學生用不到
// 請假／補課流程，也不參加弈廳。旗標由 student layout 在伺服器端查好
// 傳入，避免客戶端先渲染再消失的閃爍。
const CLASS_ONLY_HREFS = ['/student/leave-request', '/student/makeup-request', '/student/go-hall'];

export default function AppShell({
  role,
  hasClassEnrollment = true,
  children,
}: {
  role: Role;
  hasClassEnrollment?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { showToast } = useToast();
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([]);
  const [selfName, setSelfName] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPositionedRef = useRef(false);

  useEffect(() => {
    if (role !== 'STUDENT') return;
    fetch('/api/students/me/siblings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setSelfName(data.self.name);
        setSiblings(data.siblings);
      });
  }, [role]);

  async function switchToSibling(targetStudentId: string) {
    setSwitching(true);
    try {
      const tokenRes = await fetch('/api/auth/family-switch-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStudentId }),
      });
      if (!tokenRes.ok) {
        showToast('切換失敗，可能已解除手足關係，請重新整理');
        return;
      }
      const { switchToken } = await tokenRes.json();
      const result = await signIn('credentials', { switchToken, redirect: false });
      // A full navigation (not router.push) is required here: this component
      // is already mounted under /student for the pre-switch identity, and
      // Next.js's client router won't re-run server components or this
      // component's own siblings-fetch effect for a same-route transition.
      // Without a hard reload, the header and page content would keep
      // showing the OLD identity even though the session cookie has changed.
      if (result?.error) {
        showToast('切換失敗，請稍後再試');
        return;
      }
      window.location.href = '/student';
    } finally {
      setSwitching(false);
      setSwitcherOpen(false);
    }
  }

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
            {NAV_LINKS[role]
              .filter((link) => hasClassEnrollment || !CLASS_ONLY_HREFS.includes(link.href))
              .map((link) => {
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
          {role === 'STUDENT' && siblings.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setSwitcherOpen((v) => !v)}
                className="flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink hover:opacity-80 sm:text-sm"
              >
                {selfName} ▾
              </button>
              {switcherOpen && (
                <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-borderStrong bg-card py-1 text-left shadow-md">
                  <div className="px-3 py-1.5 text-xs font-semibold text-inkMuted">{selfName}（目前）</div>
                  {siblings.map((s) => (
                    <button
                      key={s.id}
                      disabled={switching}
                      onClick={() => switchToSibling(s.id)}
                      className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-stripe disabled:opacity-50"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <NotificationBell />
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
