import { describe, it, expect } from 'vitest';
import { buildExportWorkbook } from './exportExcel';

describe('buildExportWorkbook', () => {
  const headers = ['姓名', '班級'];
  const rows: (string | number)[][] = [
    ['小明', '數學A班、英文個別輔導'],
    ['小華', 42],
  ];

  it('writes header and data values in order', () => {
    const ws = buildExportWorkbook(headers, rows).getWorksheet(1)!;
    expect(ws.getCell('A1').value).toBe('姓名');
    expect(ws.getCell('B1').value).toBe('班級');
    expect(ws.getCell('A2').value).toBe('小明');
    expect(ws.getCell('B3').value).toBe(42);
  });

  it('applies 微軟正黑體 to every cell, with a bold header row', () => {
    const ws = buildExportWorkbook(headers, rows).getWorksheet(1)!;
    expect(ws.getCell('A1').font).toMatchObject({ name: '微軟正黑體', bold: true });
    expect(ws.getCell('A2').font).toMatchObject({ name: '微軟正黑體' });
    expect(ws.getCell('B3').font).toMatchObject({ name: '微軟正黑體' });
    expect(ws.getCell('A2').font?.bold).toBeFalsy();
  });

  it('sizes columns to content (CJK counts double) within sane bounds', () => {
    const ws = buildExportWorkbook(headers, rows).getWorksheet(1)!;
    const nameWidth = ws.getColumn(1).width ?? 0;
    const classWidth = ws.getColumn(2).width ?? 0;
    // 班級欄內容長很多，欄寬要明顯比姓名欄寬，且都落在下限與上限之間
    expect(classWidth).toBeGreaterThan(nameWidth);
    expect(nameWidth).toBeGreaterThanOrEqual(8);
    expect(classWidth).toBeLessThanOrEqual(50);
  });

  it('produces a serializable xlsx buffer', async () => {
    const buffer = await buildExportWorkbook(headers, rows).xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
