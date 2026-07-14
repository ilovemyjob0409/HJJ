interface TimeRange {
  startTime: string;
  endTime: string;
}

interface WeeklyWindow extends TimeRange {
  weekday: number;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isWithinAvailability(
  requested: WeeklyWindow,
  availabilities: WeeklyWindow[]
): boolean {
  return availabilities.some(
    (a) =>
      a.weekday === requested.weekday &&
      toMinutes(requested.startTime) >= toMinutes(a.startTime) &&
      toMinutes(requested.endTime) <= toMinutes(a.endTime)
  );
}

export function slotsOverlap(a: TimeRange, b: TimeRange): boolean {
  return toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}
