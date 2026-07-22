'use client';

import { useEffect, useState } from 'react';

export default function Logo({ className }: { className?: string }) {
  const [src, setSrc] = useState('/logo.png');

  useEffect(() => {
    const root = document.documentElement;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    const update = () => {
      const explicit = root.getAttribute('data-theme');
      const isDark = explicit ? explicit === 'dark' : mql.matches;
      setSrc(isDark ? '/logo-dark.png' : '/logo.png');
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    mql.addEventListener('change', update);
    return () => {
      observer.disconnect();
      mql.removeEventListener('change', update);
    };
  }, []);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="MUP" className={className} />;
}
