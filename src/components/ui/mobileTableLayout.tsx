'use client';

import { ReactNode, createContext, useContext } from 'react';

export type MobileTableLayout = 'card' | 'table';

// 區段層級的手機表格版型：行政後台整段維持傳統表格（橫滑），學生／老師端用卡片。
// 個別表格傳 DataTable 的 mobileLayout prop 仍可覆蓋這裡的預設
const MobileTableLayoutContext = createContext<MobileTableLayout>('card');

export function useMobileTableLayout() {
  return useContext(MobileTableLayoutContext);
}

export function MobileTableLayoutProvider({ value, children }: { value: MobileTableLayout; children: ReactNode }) {
  return <MobileTableLayoutContext.Provider value={value}>{children}</MobileTableLayoutContext.Provider>;
}
