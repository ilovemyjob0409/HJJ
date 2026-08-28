type IconProps = { className?: string };

const shared = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function LeaveIcon({ className }: IconProps) {
  return (
    <svg {...shared} strokeWidth={1.75} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M9 14.5h6" />
    </svg>
  );
}

export function MakeupIcon({ className }: IconProps) {
  return (
    <svg {...shared} strokeWidth={1.75} className={className}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function AttendanceIcon({ className }: IconProps) {
  return (
    <svg {...shared} strokeWidth={1.75} className={className}>
      <rect x="5" y="6" width="14" height="14" rx="2" />
      <path d="M9 4.5h6a1 1 0 0 1 1 1.5H8a1 1 0 0 1 1-1.5Z" />
      <path d="m9 13 2.5 2.5L16 11" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...shared} strokeWidth={2} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
