const H_MM_PATTERN = /^(\d{1,2}):(\d{1,2})$/;

export function normalizeTimeInput(value: string): string {
  const trimmed = value.trim();
  const match = H_MM_PATTERN.exec(trimmed);
  if (!match) return trimmed;
  const [, hour, minute] = match;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
