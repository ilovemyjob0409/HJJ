import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'link';
  tone?: 'brand' | 'muted' | 'danger';
  loading?: boolean;
}

const LINK_TONE_CLASS: Record<NonNullable<ButtonProps['tone']>, string> = {
  brand: 'text-brandDark',
  muted: 'text-inkMuted',
  danger: 'text-rejected',
};

export default function Button({
  variant = 'primary',
  tone = 'brand',
  loading = false,
  className = '',
  disabled,
  type,
  children,
  ...props
}: ButtonProps) {
  if (variant === 'link') {
    return (
      <button
        type={type ?? 'button'}
        className={`hover:underline disabled:cursor-not-allowed disabled:opacity-50 ${LINK_TONE_CLASS[tone]} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {children}
      </button>
    );
  }
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50';
  // Only one cursor class is ever present, so Tailwind's output order can't
  // make the wrong one win.
  const cursor = loading ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed';
  const styles =
    variant === 'primary'
      ? 'bg-brand text-brandInk hover:bg-brandDark'
      : 'border border-borderStrong bg-card text-ink hover:bg-stripe';
  return (
    <button
      type={type}
      className={`${base} ${cursor} ${styles} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
