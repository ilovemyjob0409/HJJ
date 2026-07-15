export type KnownStatus = 'APPROVED' | 'PENDING_ADMIN' | 'PENDING_ASSIGNMENT' | 'REJECTED' | 'ASSIGNED';

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
};

export function getStatusBadgeConfig(status: string): StatusConfig {
  return STATUS_CONFIG[status as KnownStatus] ?? { label: status, bg: 'bg-gray-100', text: 'text-gray-600' };
}

export default function StatusBadge({ status }: { status: string }) {
  const { label, bg, text } = getStatusBadgeConfig(status);
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
}
