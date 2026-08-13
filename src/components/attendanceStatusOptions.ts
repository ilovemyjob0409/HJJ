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

// 個別輔導的額度與補課資格完全不看這兩種點名狀態（額度以預約為準、
// 補課資格＝CANCELLED_LATE 或 ABSENT），顯示出來只會誤導行政以為會退額度；
// 請假一律走取消預約流程。
export const TUTORING_HIDDEN_STATUSES: AttendanceStatusValue[] = ['ON_LEAVE', 'NOT_REGISTERED'];

export function visibleStatusOptions(
  hidden: readonly AttendanceStatusValue[] | undefined,
  current: EditableStatus
): StatusOption[] {
  if (!hidden || hidden.length === 0) return STATUS_OPTIONS;
  return STATUS_OPTIONS.filter(
    (o) => o.value === current || !hidden.includes(o.value as AttendanceStatusValue)
  );
}
