import { InputHTMLAttributes } from 'react';

// date/time 欄位的內部 segment 文字被 globals.css 釘成 placeholder 灰
//（Safari 深夜模式半透明 segment 的處理），已填值時要標上 data-filled
// 讓 CSS 換回 ink 色——否則選完日期欄位文字仍是灰的，看不出到底選了沒。
// 全站 date/time 欄位都是受控元件（value 為字串），非受控一律當未填。
export function isDateTimeFilled(type: string | undefined, value: unknown): boolean {
  return (type === 'date' || type === 'time') && typeof value === 'string' && value !== '';
}

export default function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-filled={isDateTimeFilled(props.type, props.value) || undefined}
      className={`rounded-lg border border-borderInput bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25 ${className}`}
      {...props}
    />
  );
}
