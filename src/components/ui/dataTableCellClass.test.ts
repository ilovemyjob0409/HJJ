import { describe, it, expect } from 'vitest';
import { getCellClass } from './dataTableCellClass';

describe('getCellClass', () => {
  const base = 'whitespace-nowrap px-4 py-2 font-semibold md:whitespace-normal';

  it('returns the base class unchanged when the column has no width or className', () => {
    expect(getCellClass(base, {})).toBe(base);
  });

  it('appends width when specified', () => {
    expect(getCellClass(base, { width: 'w-40' })).toBe(`${base} w-40`);
  });

  it('appends className when specified', () => {
    expect(getCellClass(base, { className: 'text-left' })).toBe(`${base} text-left`);
  });

  it('appends width then className when both are specified', () => {
    expect(getCellClass(base, { width: 'w-40', className: 'text-left' })).toBe(`${base} w-40 text-left`);
  });
});
