'use client';

import { useState } from 'react';
import Button from './Button';

interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

interface ExportExcelButtonProps<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  // 檔名不含副檔名，會自動加上日期與 .xlsx
  filename: string;
  label?: string;
  className?: string;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// 匯出目前表格資料為 Excel（.xlsx，全儲存格微軟正黑體＋表頭粗體＋自動欄寬，
// 見 lib/exportExcel.ts）。columns 是獨立於畫面用 Column 的純文字欄位定義，
// 畫面欄位常常是徽章/按鈕等 React 節點，無法直接轉成文字，所以匯出要另外
// 指定 value() 取純文字。exceljs 走動態 import，不佔頁面初始 bundle。
export default function ExportExcelButton<T>({ rows, columns, filename, label = '匯出 Excel', className }: ExportExcelButtonProps<T>) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const { buildExportWorkbook } = await import('@/lib/exportExcel');
      const workbook = buildExportWorkbook(
        columns.map((c) => c.header),
        rows.map((row) => columns.map((c) => c.value(row)))
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}_${todayStamp()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button type="button" variant="secondary" onClick={handleExport} loading={exporting} disabled={rows.length === 0} className={className}>
      {label}
    </Button>
  );
}
