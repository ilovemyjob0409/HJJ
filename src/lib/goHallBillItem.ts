// 弈廳帳單的項目顯示名稱（收費清單、推播、學生繳費頁共用）。
export function goHallItemName(bill: { goHallItem: 'TICKETS' | 'SEASON_PASS' | null; goHallTickets: number | null }): string | null {
  if (bill.goHallItem === 'TICKETS') return `弈廳堂票 ${bill.goHallTickets ?? 0} 堂`;
  if (bill.goHallItem === 'SEASON_PASS') return '弈廳季票';
  return null;
}
