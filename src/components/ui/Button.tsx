import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export default function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-brand text-brandInk hover:bg-brandDark'
      : 'border border-borderStrong bg-card text-ink hover:bg-stripe';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
