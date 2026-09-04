// 點名頁 fetch 防呆：native date input 可用鍵盤清空（value 變 ''），
// 空日期不打 API；API 回錯誤物件時不得把非陣列塞進 DataTable。

/** 日期欄有值才允許發查詢／開啟點名。 */
export function hasDate(date: string): boolean {
  return date !== '';
}

/** 回應正常且 body 是陣列才回傳列資料；否則回 null，呼叫端保留原資料。 */
export function rowsFromResponse<T>(ok: boolean, body: unknown): T[] | null {
  return ok && Array.isArray(body) ? (body as T[]) : null;
}

/** 班級點名 API 的 body 是 { roster, quotaByStudentId }；roster 不是陣列一律視為失敗。 */
export function classRosterFromResponse<R, Q>(
  ok: boolean,
  body: unknown
): { roster: R[]; quotaByStudentId: Q } | null {
  if (!ok || typeof body !== 'object' || body === null) return null;
  const b = body as { roster?: unknown; quotaByStudentId?: unknown };
  if (!Array.isArray(b.roster)) return null;
  return { roster: b.roster as R[], quotaByStudentId: (b.quotaByStudentId ?? {}) as Q };
}
