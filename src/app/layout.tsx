import './globals.css';
import Providers from './providers';

export const metadata = { title: '補習班補課系統' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
