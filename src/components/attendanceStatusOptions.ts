export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED';
export type EditableStatus = AttendanceStatusValue | 'UNMARKED';

export interface StatusOption {
  value: EditableStatus;
  label: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'UNMARKED', label: '未點名' },
  { value: 'PRESENT', label: '出席' },
  { value: 'LATE', label: '遲到' },
  { value: 'LEFT_EARLY', label: '早退' },
  { value: 'ON_LEAVE', label: '請假' },
  { value: 'NOT_REGISTERED', label: '未報名' },
  { value: 'ABSENT', label: '缺席未請假' },
];

// 2026-09-04 使用者定案：個別輔導點名只留「未點名／出席」。額度以預約＋出席
// 紀錄為準（非缺席的出席紀錄才扣堂）、請假一律走取消預約流程；不點缺席——
// 沒到的留在未點名，隔日缺席推播（sendMissedSessionReminders 只看
// attendance:null）才會接手通知家長改約，點了缺席反而會讓推播跳過。
export const TUTORING_HIDDEN_STATUSES: AttendanceStatusValue[] = [
  'LATE',
  'LEFT_EARLY',
  'ON_LEAVE',
  'NOT_REGISTERED',
  'ABSENT',
];

// 2026-09-04 使用者定案：一般班級點名拿掉遲到／早退，留「未點名／出席／請假／
// 未報名／缺席未請假」。弈廳／活動／一對一維持完整選項（弈廳扣堂票的「到場」
// 判斷包含遲到/早退，見 attendanceService）。
export const CLASS_HIDDEN_STATUSES: AttendanceStatusValue[] = ['LATE', 'LEFT_EARLY'];

export function visibleStatusOptions(
  hidden: readonly AttendanceStatusValue[] | undefined,
  current: EditableStatus
): StatusOption[] {
  if (!hidden || hidden.length === 0) return STATUS_OPTIONS;
  return STATUS_OPTIONS.filter(
    (o) => o.value === current || !hidden.includes(o.value as AttendanceStatusValue)
  );
}
