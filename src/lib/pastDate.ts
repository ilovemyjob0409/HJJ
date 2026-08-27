import { taipeiDateKey } from './taipeiDate';

// Shared "has this date passed?" rule for registration cancellation, matching
// the listOpen* boundary (date >= today midnight counts as still open).
// "今天"一律以台北曆日為準：正式站伺服器是 UTC，台北 00:00–07:59 這段時間
// 伺服器當地時間還沒跨到隔天，若用 new Date().setHours(0,0,0,0)（伺服器
// 當地午夜）會誤把台北昨天算成「還沒過」。
export function isBeforeToday(date: Date | string, now: Date = new Date()): boolean {
  const [y, m, d] = taipeiDateKey(now).split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  return new Date(date) < today;
}
