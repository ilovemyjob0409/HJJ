'use client';

import { useEffect, useRef, useState } from 'react';

export default function CollapsibleSearchInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const collapse = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <div
      role="search"
      onBlur={(e) => {
        // Auto-collapse only when focus leaves the whole control and no filter is active.
        if (open && !value.trim() && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
      className={`flex h-[38px] w-full items-center overflow-hidden rounded-lg border transition-[max-width,background-color,border-color] duration-300 ease-out ${
        open
          ? 'max-w-md border-borderInput bg-card focus-within:border-brandDark focus-within:ring-2 focus-within:ring-brandDark/25'
          : 'max-w-[38px] border-transparent bg-transparent'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? '收合搜尋' : '展開搜尋'}
        onClick={() => (open ? collapse() : setOpen(true))}
        className="flex h-full w-[38px] shrink-0 cursor-pointer items-center justify-center text-inkMuted transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.2" y2="16.2" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="text"
        tabIndex={open ? 0 : -1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') collapse();
        }}
        className={`h-full min-w-0 flex-1 bg-transparent pr-1 text-sm text-ink outline-none transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {open && value && (
        <button
          type="button"
          aria-label="清除搜尋"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="flex h-full w-8 shrink-0 cursor-pointer items-center justify-center text-inkMuted transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
