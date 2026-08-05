'use client';

import Button from './Button';

interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

interface ExportCsvButtonProps<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  // 檔名不含副檔名，會自動加上日期與 .csv
  filename: string;
  label?: string;
  className?: string;
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// 匯出目前表格資料為 CSV（UTF-8 BOM，Excel 開啟中文不會亂碼）。
// columns 是獨立於畫面用 Column 的純文字欄位定義，畫面欄位常常是徽章/按鈕等
// React 節點，無法直接轉成文字，所以匯出要另外指定 value() 取純文字。
export default function ExportCsvButton<T>({ rows, columns, filename, label = '匯出 CSV', className }: ExportCsvButtonProps<T>) {
  function handleExport() {
    const header = columns.map((c) => escapeCsvField(c.header)).join(',');
    const lines = rows.map((row) => columns.map((c) => escapeCsvField(String(c.value(row)))).join(','));
    const csv = [header, ...lines].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${todayStamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="secondary" onClick={handleExport} disabled={rows.length === 0} className={className}>
      {label}
    </Button>
  );
}
