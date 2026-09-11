// 純日期工具（client 可 import）：不得依賴 services/*——依賴鏈牽到 @/lib/db 會
// 讓 client bundle 打包失敗，同 taipeiDate.ts 檔頭說明的理由。
import { taipeiDateKey } from './taipeiDate';

export const PRIZE_EXPIRY_DAYS = 30;
export const PRIZE_REMIND_BEFORE_DAYS = 7;

// 'YYYY-MM-DD' ± N 天。一律 Date.UTC——本地建構子在非 UTC 時區會偏移一天。
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 領取期限（含當日有效）：兌換當下的台北曆日 + 30 天。
export function prizeDeadlineKey(createdAt: Date): string {
  return addDaysToKey(taipeiDateKey(createdAt), PRIZE_EXPIRY_DAYS);
}

// 到期前 7 天開始提醒的那一天。
export function prizeRemindFromKey(createdAt: Date): string {
  return addDaysToKey(prizeDeadlineKey(createdAt), -PRIZE_REMIND_BEFORE_DAYS);
}
