# 個別輔導可預約時段改為月曆網格

## 背景與目標

`/student/tutoring` 目前用「未來兩週可預約時段」清單卡片顯示可預約日期：每張卡片是一天，卡片上直接列出當天每個時段的剩餘名額小標籤，點卡片標題展開開始／結束時間選擇器。

使用者希望改成月曆網格樣式（點某天才展開該天可選時段），並在確認範圍時做了三個決定：

1. **只鎖定當月**，不做上一月／下一月導覽。
2. 展開的時段選擇**顯示在月曆下方**（沿用現有卡片展開模式），不做彈窗／底部抽屜。
3. 日期格子在點選前**不顯示名額**，只標示「這天有開課」；實際剩餘名額點進去才看到。

這把原本「兩週」的人為限制換成「當月」的人為限制，介面從清單卡片換成月曆格子，但底層預約／取消／補課的商業邏輯完全不變。

## 範圍

**這次改的**：`/student/tutoring` 頁面的「未來可預約時段」區塊的呈現方式，以及後端 `GET /api/tutoring-availability` 回傳的日期範圍（從「未來 14 天」改成「當月剩餘天數」）。

**不改的**：`listAvailability` 服務函式本身的簽名與邏輯（維持通用、可測試）、預約／取消／補課申請的所有既有 API 與商業規則、`我的預約紀錄`表格、首頁卡片、行政端頁面。

## 資料層

`src/lib/services/tutoringBookingService.ts` 的 `listAvailability(enrollmentId, days = 14)` **不改**——它已經是通用的「從今天起算 N 天」函式，`Task 6` 既有測試都假設這個簽名，改簽名會波及測試與其他呼叫方，且此函式本身沒有「兩週」的硬編碼假設，不需要為了這個功能改動它。

新增一個小型、可獨立測試的日期函式，放在 `tutoringBookingService.ts`（與既有 `taipeiDateKey`/`utcDateKey` 同一個檔案，維持這個檔案「小型 per-domain 日期工具」的既有慣例）：

```ts
export function daysRemainingInTaipeiMonth(now: Date): number {
  const todayKey = taipeiDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDayOfMonth - d + 1;
}
```

`src/app/api/tutoring-availability/route.ts` 改成：

```ts
const days = daysRemainingInTaipeiMonth(new Date());
return NextResponse.json(await listAvailability(enrollmentId, days));
```

這樣「只能預約當月」是路由層的業務決定，不是 `listAvailability` 本身的能力限制——之後如果哪個管理頁面需要看更長範圍，仍可直接呼叫 `listAvailability(id, 60)` 之類，不受這次改動影響。

`daysRemainingInTaipeiMonth` 是純函式（不查資料庫），加到 `tutoringBookingService.test.ts`，覆蓋月初／月中／月底三種情況。

## 前端

`src/app/student/tutoring/page.tsx` 內：

- **移除**：現有「一天一張卡片」的 `.map()` 渲染，以及卡片上「16:00・4」這種點選前就顯示名額的小標籤列。
- **新增**：一個月曆網格（7 欄，`WEEKDAY_LABELS` 已存在可重用），靜態標題「YYYY年M月」（無導覽箭頭）。網格格子邏輯：
  - 格子日期 `< 今天`：灰階不可點。
  - 格子日期對應到 `availability` 陣列裡某個 `AvailabilityDay.date`（即：該weekday有開課且未被停開）：標色可點。
  - 其餘（該月份裡沒有對應開課 weekday 的日子）：灰階不可點，跟過去日期視覺上一致，只是原因不同（不需要在 UI 上區分「過去」跟「這天沒開課」，兩者都是「不能選」）。
- **保留不動**：`openDayForBooking`、`submitBooking`、`submitMakeup`、`startTime`/`endTime` 的 select、確定預約／取消按鈕，以及整個 `makeupFor` 補課流程——只是觸發展開面板的元素從「卡片標題按鈕」換成「月曆格子按鈕」，展開面板本身的 JSX 不變，一樣接在點選格子的下方。
- 月曆格子月份／天數的建構邏輯（第一週前面補空格、當月天數）寫成頁面內的小型 helper（例如 `buildMonthCells()`），不抽成共用元件——目前站內沒有其他地方需要月曆網格，抽成共用元件是提前優化。

`AvailabilityDay` 介面、`loadAvailability()` 的 fetch 呼叫方式都不變（後端已經回傳「當月剩餘天數」，前端不用額外過濾）。

## 邊界情況

- 月初第一天登入：`daysRemainingInTaipeiMonth` 回傳當月全部天數，月曆從第一天到最後一天都可能標色（依開課 weekday 而定）。
- 月底最後一天登入：只剩今天一天在範圍內，月曆本月只有這一天（如果剛好是開課日）可點，這是預期行為（下個月的時段要等進入下個月才看得到）。
- `TutoringWindowClosure`（停開日）：`listAvailability` 已經會排除，月曆格子自然就不會標色，不需要額外邏輯。
- 學生有多個報名（多個 program）：現有「切換報名」的圓角按鈕邏輯不變，切換後月曆重新標色對應新 program 的開課 weekday。

## 測試計畫

- `daysRemainingInTaipeiMonth`：新增 3 個測試案例（月初、月中、月底），純函式測試，不需要資料庫。
- `listAvailability` 本身：不改動，既有測試不受影響。
- 前端月曆格子渲染／點選展開：這個 codebase 沒有 component test 慣例（只測 `src/**/*.test.ts` 的服務層），維持現狀，改用瀏覽器手動驗證（既有 seed 帳號 `student@example.com`）。

## 不在這次範圍內

- 月曆換月導覽（使用者已明確表示「只能預約當月」）。
- 格子上的名額快速提示（使用者已明確表示「點進去再看到」）。
- 任何後端商業規則變動（容量計算、取消規則、補課規則皆不變）。
