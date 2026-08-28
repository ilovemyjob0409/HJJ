export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

const TAIPEI_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 資料庫日期是 UTC 日曆日；「今天」依日期慣例以台北時區判定。
export function isTodayTaipei(date: Date | string): boolean {
  return new Date(date).toISOString().slice(0, 10) === TAIPEI_DAY_FMT.format(new Date());
}

// Default to zh-TW so server-rendered pages don't follow the host's locale
// (Vercel/Node defaults to en-US and produced M/D/YYYY on the dashboard).
export function formatDateWithWeekday(date: Date | string, locale: string = 'zh-TW'): string {
  const d = new Date(date);
  // Every caller passes a pure calendar date (a leave/class/session/target
  // date, not "the current moment") serialized as UTC midnight — either a
  // date-only string or a Prisma DateTime over JSON. Reading local
  // components here would make the displayed date and weekday depend on
  // the server's timezone instead of the calendar date itself.
  const dateStr = d.toLocaleDateString(locale, { timeZone: 'UTC' });
  return `${dateStr}（${WEEKDAY_LABELS[d.getUTCDay()]}）`;
}

const TAIPEI_EN_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' });
const EN_WEEKDAY_TO_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// 給「真實時間戳」欄位（如 Bill.notifiedAt）用——輸出格式跟 formatDateWithWeekday
// 一樣，但日期與星期都用台北時區換算，不是 UTC。這類欄位存的是實際發生時刻，不是
// 日曆日期；用 UTC 判斷星期在台北凌晨（UTC 前一天 16:00–24:00）會顯示早一天。
export function formatTimestampWithWeekdayTaipei(date: Date | string, locale: string = 'zh-TW'): string {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString(locale, { timeZone: 'Asia/Taipei' });
  const weekdayIndex = EN_WEEKDAY_TO_INDEX[TAIPEI_EN_WEEKDAY_FMT.format(d)];
  return `${dateStr}（${WEEKDAY_LABELS[weekdayIndex]}）`;
}
