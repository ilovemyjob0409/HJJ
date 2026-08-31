// 表格列（桌機 tr）與卡片（手機）會各有一個對應同一筆資料的元素，
// 捲動時要挑「目前看得見」的那個——display:none 的元素 scrollIntoView 是 no-op
export function scrollToRow(key: string) {
  const candidates = [
    document.getElementById(key),
    ...Array.from(document.querySelectorAll<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)),
  ].filter((el): el is HTMLElement => el !== null);
  const visible = candidates.find((el) => el.getClientRects().length > 0) ?? candidates[0];
  visible?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
