const H_MM_PATTERN = /^(\d{1,2}):(\d{1,2})$/;
const DIGITS_PATTERN = /^\d{3,4}$/;
const VALID_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeTimeInput(value: string): string {
  const trimmed = value.trim();
  // 純數字快速輸入：905 → 09:05、1705 → 17:05（手機數字鍵盤沒有冒號）。
  if (DIGITS_PATTERN.test(trimmed)) {
    const minute = trimmed.slice(-2);
    const hour = trimmed.slice(0, -2);
    return `${hour.padStart(2, '0')}:${minute}`;
  }
  const match = H_MM_PATTERN.exec(trimmed);
  if (!match) return trimmed;
  const [, hour, minute] = match;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

// 驗證「正規化後」的值是否為合法的 24 小時制 HH:mm。
export function isValidTimeValue(value: string): boolean {
  return VALID_TIME_PATTERN.test(value);
}
