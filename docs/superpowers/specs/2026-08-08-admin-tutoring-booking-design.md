# 行政直接幫學生預約個別輔導

## 背景與目標

目前個別輔導的「正常預約」（會檢查容量、走月曆選時段）只有學生自己登入 `/student/tutoring` 才能操作。行政端 `/admin/tutoring/bookings` 只有「現場補加」——一筆一筆新增，且**不檢查容量**，設計上是給臨時現場加課用的例外操作，不適合當成行政日常「幫學生把整月堂數約好」的主要方式。

使用者希望行政能比照學生端的月曆體驗，直接幫學生預約（含補課），並確認了三個決定：

1. 用**月曆式介面，逐堂點選**（不做「一次批次自動排滿整月」）。
2. **移除現場補加**，只留月曆介面（容量已滿的例外情況，行政自行判斷是否要跟老師協調，不再是系統層級的功能）。
3. 月曆介面**一併支援補課**：行政可直接幫學生建立補課預約，不必先讓學生走 `/student/tutoring` 申請、行政再到 `/admin/makeup-requests` 審核那一輪。

另外兩個是與此無關的小改動，一併在這次做：`/admin/tutoring/bookings` 加返回鍵、`/admin/tutoring` 新增課程卡片預設收合。

## 範圍

**這次改的**：

- 抽出共用月曆／選時段元件，學生端與行政端共用。
- `/admin/tutoring/bookings` 移除「現場補加」卡片，換成「新增預約」卡片（選學生報名記錄 → 選類型：一般／補課 → 月曆選時段）。
- `GET /api/tutoring-availability` 放行 `ADMIN` 角色。
- `POST /api/tutoring-bookings/[id]/makeup` 放行 `ADMIN` 角色，且行政呼叫時直接核准（狀態變 `BOOKED`），不進入 `PENDING_ADMIN` 審核佇列。
- 新增 `listMissedBookingsForEnrollment` service 函式 + `GET /api/tutoring-bookings/makeup-eligible` route，供行政補課下拉選單使用。
- 移除 `createWalkInBooking`、`POST /api/tutoring-bookings/walk-in`、對應測試。
- `/admin/tutoring/bookings` 加返回 `/admin/tutoring` 的連結。
- `/admin/tutoring` 課程卡片的 `<details>` 移除 `open`，預設收合。

**不改的**：`createBooking`／容量檢查邏輯、`requestMakeup` 的 eligibility 規則（`CANCELLED_LATE` 或 `ABSENT`、非已補課過）、`/admin/makeup-requests` 頁面（學生自己申請的補課仍照舊走審核）、當日預約總覽表與當月出席總表、`EnrollmentManager`（報名管理維持不變）。

## 架構：共用月曆元件

`src/app/student/tutoring/page.tsx` 目前把「月曆網格＋展開選時段＋送出」的邏輯（`buildMonthCells`、`renderMonthGrid`、`openDayForBooking`、`submitBooking`/`submitMakeup`、時間 select）寫在頁面元件內部。抽成 `src/components/tutoring/TutoringBookingCalendar.tsx`：

```ts
interface TutoringBookingCalendarProps {
  enrollmentId: string;
  defaultDurationMinutes: number;
  mode: 'regular' | 'makeup';
  makeupForBookingId?: string; // mode === 'makeup' 時必填
  onBooked: () => void;
}
```

元件內部行為（原封不動搬過去，不改邏輯）：

- `mode === 'makeup'` 時渲染當月＋下月兩個月曆網格，`mode === 'regular'` 只渲染當月——沿用學生頁現有 `makeupFor ? 2 : 1` 的判斷，只是判斷依據從 `makeupFor` 狀態換成 `mode` prop。
- 送出時打哪支 API 由 `mode` 決定：
  - `regular` → `POST /api/tutoring-bookings`，body 帶 `enrollmentId`。
  - `makeup` → `POST /api/tutoring-bookings/{makeupForBookingId}/makeup`。
- 按鈕文字（`確定預約`／`確定補課時間`）、`WINDOW_FULL` 等錯誤 toast 文案，跟現有學生頁一致，原樣搬過去。
- `loadAvailability` 內部自己打 `GET /api/tutoring-availability?enrollmentId=...&months=...`，呼叫方（學生頁／行政頁）不用管這一層。

學生頁改動：保留報名切換、額度卡片、補課觸發按鈕（`setMakeupFor`）、我的預約紀錄表格；把原本內嵌的月曆／選時段 JSX 換成：

```tsx
<TutoringBookingCalendar
  enrollmentId={selectedEnrollment.id}
  defaultDurationMinutes={selectedEnrollment.defaultDurationMinutes}
  mode={makeupFor ? 'makeup' : 'regular'}
  makeupForBookingId={makeupFor?.id}
  onBooked={() => { setMakeupFor(null); loadBookings(); loadAvailability(...); loadEnrollments(); }}
/>
```

行為對學生完全無感——純重構。

## 行政端 UI

`/admin/tutoring/bookings` 的「現場補加」卡片換成「新增預約」：

1. **學生報名**下拉（沿用現有 `enrollments` state，來源 `GET /api/tutoring-enrollments`）。
2. **類型**：一般／補課 toggle。
3. 選了「補課」後，第二個下拉：**要補的缺席紀錄**，資料來自 `GET /api/tutoring-bookings/makeup-eligible?enrollmentId=`，選項顯示原本那堂的日期＋時間（例如「8/3（一）16:00-18:00」），方便行政跟學生核對是哪一堂。
4. 選定學生（＋補課模式下選定原始紀錄）後，卡片下方渲染 `<TutoringBookingCalendar enrollmentId=... mode=... makeupForBookingId=... onBooked={loadOverview}>`。
5. 沒選學生（或補課模式下沒選原始紀錄）時，月曆區塊不渲染，顯示提示文字「請先選擇學生」。

`walkInEnrollmentId`/`walkInWindowId`/`walkInStart`/`walkInEnd` 這組 state 與 `addWalkIn` 函式整段刪除。

## API 變更

**`GET /api/tutoring-availability`**：現在寫死 `session.user.role !== 'STUDENT'` 就 403。改成 `STUDENT` 或 `ADMIN` 都放行；`STUDENT` 分支維持現有「查自己的 enrollment、驗證 studentId 相符」；新增 `ADMIN` 分支直接用 body 的 `enrollmentId` 查（不檢查擁有權，因為行政本來就能操作任何學生）。`enrollmentId` 不存在仍回 404 `ENROLLMENT_NOT_FOUND`。

**`POST /api/tutoring-bookings/[id]/makeup`**：現在寫死 `session.user.role !== 'STUDENT'` 就 403。改成：

- `STUDENT`：完全不變（驗證 `original.enrollment.studentId === student.id`，成功後停在 `PENDING_ADMIN`）。
- `ADMIN`：跳過擁有權檢查，直接用 `params.id` 當 `originalBookingId`。`requestMakeup(...)` 成功後緊接著呼叫 `decideMakeup(booking.id, 'APPROVED')`，回傳前狀態已經是 `BOOKED`。兩個呼叫都可能丟已知錯誤（`WINDOW_FULL`/`ALREADY_REQUESTED`/`NOT_ELIGIBLE`），錯誤處理沿用現有 catch 區塊的 status mapping。

**新增 `listMissedBookingsForEnrollment(enrollmentId)`**（`tutoringBookingService.ts`，緊鄰 `listBookingsForStudent` 放）：邏輯與 `listBookingsForStudent` 裡算 `canRequestMakeup` 的判斷式相同（`kind === 'REGULAR'`、`status === 'CANCELLED_LATE'` 或 `attendance.status === 'ABSENT'`、`!makeupChild`），但 `where` 換成 `{ enrollmentId, kind: 'REGULAR' }`，只回傳符合條件的那幾筆（`id`、`date`、`startTime`、`endTime`）。

**新增路由 `GET /api/tutoring-bookings/makeup-eligible?enrollmentId=`**：與現有 `overview`/`monthly-summary` 同一層、同樣是 `ADMIN only`，回傳 `listMissedBookingsForEnrollment` 的結果。

**移除**：`createWalkInBooking`（service）、`src/app/api/tutoring-bookings/walk-in/route.ts`、`tutoringBookingService.test.ts` 裡 `describe('createWalkInBooking', ...)` 整段。

## 其他兩個小改動

- **返回鍵**：`src/app/admin/tutoring/bookings/page.tsx` 頁首、`<h1>` 之前加一個 `<Link href="/admin/tutoring">`，圖示＋文字比照 `src/app/admin/attendance/checkin/page.tsx` 既有的箭頭 SVG＋「返回⋯」樣式。
- **課程預設收合**：`src/app/admin/tutoring/page.tsx` 第 312 行 `<details className="group" open>` 移除 `open` 屬性，改成預設收合（`toggleProgramActive`/`deleteProgram` 等既有互動不受影響，因為都已經用 `withStopPropagation` 包住，不會因為 `<details>` 開闔狀態改變而受影響）。

## 邊界情況

- 行政幫學生訂一般堂時，若當時段容量已滿：跟學生端一樣收到 `WINDOW_FULL`，UI 顯示「這段時間名額已滿，請選別的時間」，不允許用行政身份強行超額——這次不留任何繞過容量的後門，現場真的需要超額加課，行政要自行跟老師協調課程窗口設定（容量、開課時段），而不是靠系統層級的例外。
- 行政幫學生建立補課時，若該學生根本沒有符合資格的缺席紀錄：下拉選單為空，顯示「這位學生目前沒有可補課的紀錄」，不渲染月曆。
- 同一堂缺席紀錄已經被學生自己申請過補課（`PENDING_ADMIN`）：`listMissedBookingsForEnrollment` 用 `!makeupChild` 排除，不會出現在行政的下拉裡，避免行政跟學生同時各申請一次。
- 行政幫學生建立補課预约後，若該堂原本已經在 `/admin/makeup-requests` 排隊等審核：不會發生，因為一堂缺席只能有一個 `makeupChild`（DB 唯一約束＋`ALREADY_REQUESTED` 檢查），行政操作跟學生自助申請互斥。

## 測試計畫

- `listMissedBookingsForEnrollment`：只回傳指定 enrollment 的資料（不含同一學生其他 enrollment 或其他學生）、排除已有 `makeupChild` 的、排除非 `REGULAR`／未缺席的。
- `GET /api/tutoring-availability`：新增 `ADMIN` 呼叫任意 `enrollmentId` 成功案例；確認 `STUDENT` 查自己以外的 `enrollmentId` 仍 403；未登入／其他角色仍 403。
- `POST /api/tutoring-bookings/[id]/makeup`：新增 `ADMIN` 呼叫後 `status` 直接是 `BOOKED` 的案例；`WINDOW_FULL`/`ALREADY_REQUESTED` 時 ADMIN 呼叫也正確回傳對應錯誤碼；`STUDENT` 呼叫維持原行為（含非本人 403 的既有案例)。
- `GET /api/tutoring-bookings/makeup-eligible`：`ADMIN only`，非 ADMIN 呼叫 403。
- 刪除 `createWalkInBooking` 相關測試（連同函式一起移除，不留 orphan 測試）。
- 前端（`TutoringBookingCalendar`、行政新增預約卡片）：沿用專案現有慣例，不寫 component test，改用 dev server 手動驗證：學生端月曆行為不變、行政端能選學生／類型／補課原始紀錄後正常預約與補課、容量已滿時兩端都擋下。

## 不在這次範圍內

- 批次自動排課（使用者已明確選「逐堂點選」）。
- 允許行政繞過容量上限的正常預約（現場補加整個移除，不留任何繞過容量的路徑）。
- `/admin/makeup-requests` 審核頁面本身的任何改動（學生自助申請的補課審核流程不變）。
- 月曆式介面的視覺／UX 調整（使用者表示「功能先做，之後考慮調整UI」，這次先用跟學生端一致的樣式直接搬過去，不額外設計行政專屬的視覺風格）。
