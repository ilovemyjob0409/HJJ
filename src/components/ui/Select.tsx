import { SelectHTMLAttributes } from 'react';

export default function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-lg border border-[#D8C9A8] bg-selectBg px-3 py-2 text-sm text-selectText focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25 ${className}`}
      {...props}
    />
  );
}
