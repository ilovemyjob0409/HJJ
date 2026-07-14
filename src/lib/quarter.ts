export interface Quarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

export function getQuarter(date: Date): Quarter {
  const year = date.getFullYear();
  const quarter = (Math.floor(date.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { year, quarter };
}

export function isSameQuarter(a: Date, b: Date): boolean {
  const qa = getQuarter(a);
  const qb = getQuarter(b);
  return qa.year === qb.year && qa.quarter === qb.quarter;
}

export function getQuarterRange(date: Date): { start: Date; end: Date } {
  const { year, quarter } = getQuarter(date);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { start, end };
}
