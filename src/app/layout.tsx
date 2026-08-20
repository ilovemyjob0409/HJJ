import Script from 'next/script';
import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'MUP',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MUP', statusBarStyle: 'default' as const },
  icons: { apple: '/apple-touch-icon.png' },
};

const THEME_INIT_SCRIPT = `
  try {
    var theme = localStorage.getItem('mup-theme');
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
