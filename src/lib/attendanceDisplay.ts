// 出缺勤表格的顯示狀態：有點名紀錄用點名結果；沒點名而仍是 BOOKED 的列，
// 依出缺勤查詢的取列條件（getTutoringEnrollmentAttendance／
// listAttendanceForStudent）必然是「過期未到」→ 顯示 NO_SHOW（未到課）。
export function attendanceDisplayStatus(attendanceStatus: string | null, bookingStatus: string): string {
  return attendanceStatus ?? (bookingStatus === 'BOOKED' ? 'NO_SHOW' : bookingStatus);
}
