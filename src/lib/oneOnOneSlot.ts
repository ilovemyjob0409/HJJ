// 一對一補課固定時長。純常數與純函式（client-safe）：
// 表單即時顯示結束時間、service 計算保留時段都用這裡，避免兩端不一致。
export const ONE_ON_ONE_DURATION_MINUTES = 40;

export function oneOnOneEndTime(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + ONE_ON_ONE_DURATION_MINUTES;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
