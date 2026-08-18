import ExcelJS from 'exceljs';

// 全站報表匯出的共用 Excel 產生器：所有儲存格固定微軟正黑體（使用者指定的
// 全站預設）、表頭粗體、欄寬依內容自動調整。CSV 存不了字型，這是改走
// .xlsx 的主因——任何電腦打開都保證同字型。
// 注意：exceljs 體積不小，呼叫端（ExportExcelButton）用動態 import 載入
// 本模組，避免進到頁面初始 bundle。

const FONT_NAME = '微軟正黑體';
const MIN_WIDTH = 8;
const MAX_WIDTH = 50;

// 估算顯示寬度：CJK 全形字約佔兩個半形字元寬。
function displayWidth(value: string): number {
  let width = 0;
  for (const ch of value) {
    width += /[ᄀ-￦]/.test(ch) ? 2 : 1;
  }
  return width;
}

export function buildExportWorkbook(headers: string[], rows: (string | number)[][]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('工作表1');

  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = rowNumber === 1 ? { name: FONT_NAME, bold: true } : { name: FONT_NAME };
    });
  });

  headers.forEach((header, index) => {
    let width = displayWidth(header);
    for (const row of rows) {
      const value = row[index];
      if (value !== undefined) width = Math.max(width, displayWidth(String(value)));
    }
    // +2 呼吸空間；夾在上下限之間，避免超長內容把欄拉到不可用。
    worksheet.getColumn(index + 1).width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + 2));
  });

  return workbook;
}
