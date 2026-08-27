import { SelectHTMLAttributes } from 'react';

export default function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-lg border border-borderInput bg-selectBg py-2 pl-3 pr-8 text-sm text-selectText focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25 ${className}`}
      {...props}
    />
  );
}
