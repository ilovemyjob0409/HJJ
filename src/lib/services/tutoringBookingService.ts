export const SLOT_MINUTES = 30;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date);
}

export function countOverlapsInSlot(slotStart: number, slotEnd: number, ranges: { startTime: string; endTime: string }[]): number {
  return ranges.filter((r) => toMinutes(r.startTime) < slotEnd && toMinutes(r.endTime) > slotStart).length;
}

export function buildSlotRemaining(
  windowStartTime: string,
  windowEndTime: string,
  capacity: number,
  existingRanges: { startTime: string; endTime: string }[]
): { startTime: string; remaining: number }[] {
  const start = toMinutes(windowStartTime);
  const end = toMinutes(windowEndTime);
  const slots: { startTime: string; remaining: number }[] = [];
  for (let t = start; t < end; t += SLOT_MINUTES) {
    const used = countOverlapsInSlot(t, t + SLOT_MINUTES, existingRanges);
    slots.push({ startTime: minutesToHHMM(t), remaining: Math.max(0, capacity - used) });
  }
  return slots;
}

export function hasCapacityForRange(
  windowStartTime: string,
  windowEndTime: string,
  capacity: number,
  existingRanges: { startTime: string; endTime: string }[],
  candidate: { startTime: string; endTime: string }
): boolean {
  const windowStart = toMinutes(windowStartTime);
  const windowEnd = toMinutes(windowEndTime);
  const candStart = toMinutes(candidate.startTime);
  const candEnd = toMinutes(candidate.endTime);
  for (let t = Math.max(windowStart, candStart); t < Math.min(windowEnd, candEnd); t += SLOT_MINUTES) {
    const used = countOverlapsInSlot(t, t + SLOT_MINUTES, existingRanges);
    if (used + 1 > capacity) return false;
  }
  return true;
}

// 前一天 23:59（台北）為分界：今天（台北）已到達或超過預約日期＝當天取消或更晚，視為 late。
export function isCancellationLate(bookingDateUtcKey: string, nowTaipeiKey: string): boolean {
  return nowTaipeiKey >= bookingDateUtcKey;
}
