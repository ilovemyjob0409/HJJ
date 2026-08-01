export type KnownStatus =
  | 'APPROVED'
  | 'PENDING_ADMIN'
  | 'PENDING_ASSIGNMENT'
  | 'REJECTED'
  | 'ASSIGNED'
  | 'PRESENT'
  | 'LATE'
  | 'LEFT_EARLY'
  | 'ON_LEAVE'
  | 'ABSENT'
  | 'NOT_REGISTERED';

interface StatusConfig {
  label: string;
  bg: string;
  text: string;
}

const STATUS_CONFIG: Record<KnownStatus, StatusConfig> = {
  APPROVED: { label: '已核准', bg: 'bg-approvedBg', text: 'text-approved' },
  PENDING_ADMIN: { label: '待確認', bg: 'bg-pendingBg', text: 'text-pending' },
  PENDING_ASSIGNMENT: { label: '待確認', bg: 'bg-pendingBg', text: 'text-pending' },
  REJECTED: { label: '已拒絕', bg: 'bg-rejectedBg', text: 'text-rejected' },
  ASSIGNED: { label: '已指派', bg: 'bg-assignedBg', text: 'text-assigned' },
  PRESENT: { label: '出席', bg: 'bg-approvedBg', text: 'text-approved' },
  LATE: { label: '遲到', bg: 'bg-pendingBg', text: 'text-pending' },
  LEFT_EARLY: { label: '早退', bg: 'bg-pendingBg', text: 'text-pending' },
  ON_LEAVE: { label: '請假', bg: 'bg-assignedBg', text: 'text-assigned' },
  ABSENT: { label: '缺席未請假', bg: 'bg-rejectedBg', text: 'text-rejected' },
  // 報名時聲明不出席、未繳該堂費用 → 不扣堂；中性灰顯示
  NOT_REGISTERED: { label: '未報名', bg: 'bg-borderSubtle', text: 'text-inkMuted' },
};

export function getStatusBadgeConfig(status: string): StatusConfig {
  return STATUS_CONFIG[status as KnownStatus] ?? { label: status, bg: 'bg-borderSubtle', text: 'text-inkMuted' };
}

export default function StatusBadge({ status }: { status: string }) {
  const { label, bg, text } = getStatusBadgeConfig(status);
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
}
