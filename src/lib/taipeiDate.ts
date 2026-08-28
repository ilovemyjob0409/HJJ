// 零依賴的純日期工具：只用 Intl.DateTimeFormat 取得台北曆日 'YYYY-MM-DD'。
// 刻意獨立成檔（不要放進 services/tutoringBookingService.ts）：
// pastDate.ts 等純模組會被 'use client' 頁面直接 import，一旦依賴鏈牽到
// services/* 就會連帶拉進 @/lib/db（Prisma/pg）、pushService（web-push）等
// server-only 套件，讓 client bundle 打包失敗（Module not found: ws/net/tls/fs）。
export const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date);
}
