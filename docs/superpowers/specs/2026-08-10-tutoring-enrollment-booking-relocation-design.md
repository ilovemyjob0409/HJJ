# 個別輔導：預約搬到報名列表、報名支援多選

## 背景與目標

`/admin/tutoring/bookings`（查看每日預約總覽）目前有一張「新增預約」卡片：行政要先從下拉選單挑學生報名記錄，再選一般／補課，才能叫出月曆幫學生訂位。使用者認為這功能放錯地方——應該在 `/admin/tutoring` 頁面「學生報名管理」（`EnrollmentManager.tsx`）下方的已報名學生列表裡，針對「那一行學生」直接觸發預約，不用再選一次學生。

同時，「新增報名」（幫學生報名某門課程）這個動作使用者希望能一次選多個學生（例如一個班的學生一起報名同一門課、同樣堂數），但「哪一天哪個時段」這種預約仍然維持一人一次的單一操作，不做批次。

三個決定（已與使用者確認）：
1. 「新增報名」表單的學生欄位改可以多選（多個學生＋一個共用課程＋一個共用每月堂數，一次送出建立多筆報名）。
2. 已報名學生列表每一行的「操作」欄與「額度覆寫」欄合併成單一「編輯」按鈕，點下去開一個小 Modal，裡面放每月堂數覆寫、預約（對「這一行」開出預約 Modal，一般／補課都要支援，跟現在被移除的卡片功能對等，單一學生單一操作）、停用／啟用、移除。
3. `/admin/tutoring/bookings` 頁面本身保留（當日預約總覽表、當月出席總表、返回鍵都不動），只拿掉「新增預約」卡片。

批次報名的部分成功/失敗處理（已確認）：成功的照建，失敗的用 toast 告訴行政是哪幾位失敗。

## 範圍

**這次改的**：
- `src/app/admin/tutoring/EnrollmentManager.tsx`：新增報名表單學生欄位改多選＋批次送出；已報名列表「操作」＋「額度覆寫」兩欄合併成單一「編輯」按鈕，開出內嵌 Modal（堂數覆寫／預約／停用／移除），「預約」再疊一層新的預約 Modal。
- 新檔 `src/app/admin/tutoring/AdminBookingModal.tsx`：把原本「新增預約」卡片的一般／補課邏輯（含 `TutoringBookingCalendar`、補課缺席紀錄下拉）搬過來，改成吃單一 enrollment。
- `src/app/admin/tutoring/bookings/page.tsx`：移除「新增預約」卡片與其專屬 state／effect／`enrollments` 載入。

**不改的**：後端 API 全部不動（`GET /api/tutoring-bookings/makeup-eligible`、`GET /api/tutoring-availability`、`POST /api/tutoring-bookings`、`POST /api/tutoring-bookings/[id]/makeup`、`POST /api/tutoring-enrollments` 都已經是現成、正確的介面，這次純粹是前端呼叫位置搬家＋批次呼叫既有的單筆報名 API）。共用元件 `TutoringBookingCalendar` 的 props 介面不動。當日預約總覽表、當月出席總表、返回鍵、學生端 `/student/tutoring` 完全不受影響。

## A. 新增報名表單：學生多選

`EnrollmentManager.tsx` 目前的 `studentId: string` 單選狀態，改成 `selectedStudentIds: string[]`（保留順序，方便 chip 穩定渲染）。

**互動**：搜尋輸入框邏輯不變（放大鏡＋輸入即時篩選），差異在點選一個學生時：不是直接寫入單一值關閉搜尋，而是 `setSelectedStudentIds((prev) => prev.includes(s.id) ? prev : [...prev, s.id])`，並清空 `studentQuery`（讓輸入框空著、繼續可以搜下一位）。下拉的候選清單要把「已經選過的學生」濾掉（`students.filter(s => !selectedStudentIds.includes(s.id) && s.user.name...)`），避免同一人選兩次。

**已選學生的呈現**：輸入框上方或下方加一排 chip，比照 `src/app/admin/tutoring/page.tsx` 停開日 chip 的樣式（`rounded-full bg-stripe px-2 py-0.5 text-xs text-inkMuted` ＋ `✕` 移除鈕，`text-rejected`），每個 chip 顯示學生姓名，點 ✕ 從 `selectedStudentIds` 移除。沒有選任何學生時不顯示 chip 區塊。

**送出（`createEnrollment` 改名為 `createEnrollments`）**：
```ts
async function createEnrollments() {
  if (selectedStudentIds.length === 0 || !programId) {
    showToast('請選擇至少一位學生與課程');
    return;
  }
  const quota = newMonthlyQuota === '' ? undefined : Number(newMonthlyQuota);
  const results = await Promise.all(
    selectedStudentIds.map(async (id) => {
      const res = await fetch('/api/tutoring-enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: id, programId, monthlyQuota: quota }),
      });
      const name = students.find((s) => s.id === id)?.user.name ?? id;
      return { name, ok: res.ok };
    })
  );
  const failed = results.filter((r) => !r.ok);
  const succeeded = results.length - failed.length;
  if (failed.length === 0) {
    showToast(`已新增 ${succeeded} 筆報名`);
  } else if (succeeded === 0) {
    showToast(`新增失敗：${failed.map((f) => f.name).join('、')}（可能已報名此課程）`);
  } else {
    showToast(`已新增 ${succeeded} 筆報名，${failed.length} 筆失敗：${failed.map((f) => f.name).join('、')}`);
  }
  // 整批失敗時保留已選的學生/課程/堂數，讓行政修正後可以直接重試，不用重新搜尋選人一次。
  if (succeeded > 0) {
    setSelectedStudentIds([]);
    setProgramId('');
    setNewMonthlyQuota('');
  }
  setStudentQuery('');
  load();
}
```
每個學生各打一次現有的 `POST /api/tutoring-enrollments`（該 API 已經支援單筆 `studentId/programId/monthlyQuota`，不用改），用 `Promise.all` 平行送出而不是逐一 `await`（送出速度不因為選了很多人而變慢），每筆各自成功/失敗互不影響。課程、每月堂數這兩個欄位維持原本的單選／單一輸入，套用在這次選中的所有學生身上。表單只有在「至少一筆成功」時才清空（見下方邊界情況）。

「新增報名」按鈕文字、`Card` 版面不變，只有學生欄位從單一 `<input>`+下拉變成「已選 chip 區＋搜尋框＋下拉」。

## B. 已報名列表：操作欄＋額度覆寫欄合併成「編輯」按鈕

表格目前是「學生／課程／本月狀態／額度覆寫／操作」五欄，「額度覆寫」是獨立的 Input＋儲存按鈕，「操作」是「停用」「移除」兩個並排按鈕。全部收攏成一個「編輯」按鈕，點下去開一個小 Modal，裡面放：每月堂數覆寫（Input＋儲存）、預約、停用（或啟用）、移除——跟今天稍早 `/admin/students` 編輯學生彈窗裡「設定手足」的做法一致：外層一個簡單的編輯 Modal，裡面的按鈕再疊一層更複雜的功能 Modal。表格因此簡化成「學生／課程／本月狀態／編輯」四欄。

`EnrollmentRow` 介面補上 `defaultDurationMinutes: number`（`GET /api/tutoring-enrollments` 背後的 `listEnrollments()` 已經回傳這欄位，只是這個檔案的型別沒宣告，補上即可，不用動 API）。

`columns` 拿掉「額度覆寫」整欄，「操作」欄改成單一按鈕：
```tsx
{
  header: '操作',
  render: (r) => (
    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditingEnrollment(r)}>
      編輯
    </Button>
  ),
},
```

新增 `const [editingEnrollment, setEditingEnrollment] = useState<EnrollmentRow | null>(null);` 與 `const [bookingTarget, setBookingTarget] = useState<EnrollmentRow | null>(null);`。既有的 `quotaOverride: Record<string, string>` state 保留（key 還是用 enrollment id，語意不變，只是輸入框搬進 Modal），`saveQuotaOverride` 函式不變。在 `<>...</>` 最後（`{ConfirmDialog}` 旁邊）掛載外層編輯 Modal（直接寫在 `EnrollmentManager.tsx` 裡，不獨立成檔——沿用既有的 `toggleActive`/`removeEnrollment`/`saveQuotaOverride` 函式，比照 `/admin/students` 編輯學生 Modal 也是內嵌在頁面裡、只有更複雜的「設定手足」才獨立成檔的慣例）：

```tsx
<Modal
  open={editingEnrollment !== null}
  onClose={() => setEditingEnrollment(null)}
  title={`${editingEnrollment?.studentName ?? ''}・${editingEnrollment?.programName ?? ''}`}
>
  {editingEnrollment && (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs font-medium text-inkMuted">每月堂數覆寫</p>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            placeholder="預設"
            value={quotaOverride[editingEnrollment.id] ?? ''}
            onChange={(e) => setQuotaOverride((prev) => ({ ...prev, [editingEnrollment.id]: e.target.value }))}
            className="w-20 py-1 text-sm"
          />
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => saveQuotaOverride(editingEnrollment)}>
            儲存
          </Button>
        </div>
      </div>
      <Button onClick={() => setBookingTarget(editingEnrollment)}>預約</Button>
      <Button
        variant="secondary"
        onClick={async () => {
          await toggleActive(editingEnrollment);
          setEditingEnrollment(null);
        }}
      >
        {editingEnrollment.active ? '停用' : '啟用'}
      </Button>
      <Button
        variant="secondary"
        onClick={async () => {
          await removeEnrollment(editingEnrollment);
          setEditingEnrollment(null);
        }}
      >
        移除
      </Button>
    </div>
  )}
</Modal>
{bookingTarget && (
  <AdminBookingModal
    enrollment={bookingTarget}
    onClose={() => setBookingTarget(null)}
    onBooked={load}
  />
)}
```

行為分工：
- **每月堂數覆寫**的「儲存」按鈕點下去**不**關閉編輯 Modal（跟原本表格內建的行為一致——存完可能還要接著做別的事，例如接著訂位；而且 `saveQuotaOverride` 存完只會更新 `enrollments` 列表，不會讓 `editingEnrollment` 這個 Modal 用的獨立快照物件跟著變，所以 Modal 標題／目前堂數等顯示維持存檔當下的樣子，直到關閉 Modal 重新點「編輯」才會反映最新值——這跟移除/停用不同，因為移除/停用後這個 Modal 沒有繼續開著的理由，額度覆寫則常常是「調一下就好，可能還要訂位」）。
- **停用/移除**點下去會關閉外層編輯 Modal（沿用既有的 `toggleActive`/`removeEnrollment`，兩者都已經會呼叫 `load()` 刷新列表；移除本來就有 `useConfirm` 二次確認，行為不變）。
- **預約**點下去疊出 `AdminBookingModal`（外層編輯 Modal 保持開啟、`AdminBookingModal` 疊在上面，符合 `Modal` 元件既有的多層堆疊行為），`AdminBookingModal` 成功建立預約後只關閉自己（見下方），外層編輯 Modal 仍開著，行政可以接著調堂數或訂下一堂。

**新檔 `src/app/admin/tutoring/AdminBookingModal.tsx`**（比照 `src/app/admin/students/FamilySiblingModal.tsx` 獨立成檔、同一層級 co-locate 的慣例）：

```ts
interface AdminBookingModalProps {
  enrollment: { id: string; studentId: string; studentName: string; programName: string; defaultDurationMinutes: number };
  onClose: () => void;
  onBooked: () => void;
}
```
內部 state：`kind: 'regular' | 'makeup'`（預設 `'regular'`）、`missedBookings: MissedBookingOption[]`、`makeupOriginalId: string`。`useEffect` 依賴 `[kind]`：`kind !== 'makeup'` 時清空 `missedBookings`/`makeupOriginalId` 並 return；否則打 `GET /api/tutoring-bookings/makeup-eligible?enrollmentId=${enrollment.id}` 填入 `missedBookings`，同時把 `makeupOriginalId` 重設為 `''`。

渲染（`<Modal open onClose={onClose} title={\`新增預約：${enrollment.studentName}・${enrollment.programName}\`}>`）：
- 類型 `<select>`（一般／補課），沿用原卡片的樣式與 class。
- `kind === 'makeup'` 時顯示「要補的缺席紀錄」`<select>`，選項用 `formatDateWithWeekday(b.date)}・${b.startTime}-${b.endTime}` 格式（跟原卡片一致）。
- `kind === 'makeup' && missedBookings.length === 0` 時顯示「這位學生目前沒有可補課的紀錄」，不渲染月曆。
- `kind === 'regular' || makeupOriginalId` 時渲染：
```tsx
<TutoringBookingCalendar
  key={`${kind}-${makeupOriginalId}`}
  enrollmentId={enrollment.id}
  defaultDurationMinutes={enrollment.defaultDurationMinutes}
  mode={kind}
  makeupForBookingId={kind === 'makeup' ? makeupOriginalId : undefined}
  successMessage={kind === 'makeup' ? '已建立補課預約' : '已新增預約'}
  onBooked={() => {
    onBooked();
    onClose();
  }}
/>
```
成功建立預約後直接關閉 Modal（單一學生單一操作、一次做完就收掉），列表的「本月狀態」欄位靠 `onBooked`（即 `EnrollmentManager` 的 `load()`）刷新。`key` 沿用先前在 `/admin/tutoring/bookings` 驗證過的作法：`kind`／`makeupOriginalId` 改變時強制重新掛載，避免月曆殘留舊資料。這個 Modal 每次都是「開啟時全新掛載」（`bookingTarget` 從 `null` 變成一筆資料才 render），不像原本卡片那樣常駐在頁面上，所以不需要額外的 `calendarRefreshKey`——每次點「預約」都是乾淨的新 Modal。

## C. `/admin/tutoring/bookings`：移除新增預約卡片

刪除：`EnrollmentOption`／`EnrollmentApiRow` 介面、`enrollments` state、`loadOptions()` 函式與其 `useEffect`、`newBookingEnrollmentId`／`newBookingKind`／`missedBookings`／`makeupOriginalId`／`calendarRefreshKey` 這五個 state、依賴它們的那個 `useEffect`（抓 makeup-eligible 的那個）、`newBookingEnrollment` 計算變數、整張「新增預約」`<Card>`、`TutoringBookingCalendar` 的 import。`cancel()` 函式中原本額外呼叫的 `setCalendarRefreshKey((k) => k + 1)` 一併移除（該 state 已刪除，且這頁不再需要它）。

其餘全部不動：日期選擇器、當日預約總覽表（`columns`／`cancel`／`loadOverview`）、當月出席總表（`summaryColumns`／`loadSummary`／`ExportCsvButton`）、返回鍵。

## 邊界情況

- 批次報名時，`programs`／`students` 清單本身不變（沿用 `load()` 抓到的資料），選學生的下拉只排除「這次表單裡已經選起來的」，不影響其他學生仍可被選。
- 批次報名全部失敗（例如選的人全部都已經報名過這門課）：`succeeded === 0`，toast 顯示「新增失敗：A、B、C（可能已報名此課程）」，且表單保留已選的學生／課程／堂數（不清空），讓行政確認/修正後可以直接重試，不用重新搜尋選人一次。只要至少一筆成功，就清空學生選取／課程／堂數三個欄位，視為這次操作完成。
- 「預約」Modal 開啟時，若該學生報名記錄的課程當週完全沒有可預約時段（`TutoringBookingCalendar` 內部已有這個邏輯：月曆格子全部不可點），維持元件既有行為，不特別處理。
- 行政連續幫同一個學生訂多堂：點「編輯」→「預約」→訂一堂→`AdminBookingModal` 自動關閉、外層編輯 Modal 仍開著→再點一次「預約」重新開一個乾淨的 `AdminBookingModal`，重複即可，符合「單一操作」的決定。

## 測試計畫

這次改動都是 client component 的重組（狀態管理＋JSX 結構調整），不動任何 API／service，維持專案既有慣例（沒有 component test，全部用瀏覽器手動驗證）：

- `npx tsc --noEmit` 確認型別正確（尤其 `EnrollmentRow` 補的 `defaultDurationMinutes` 欄位）。
- `npm test` 全部通過（後端沒改動，預期無影響，純粹確認沒有動到共用程式碼）。
- 瀏覽器手動驗證：
  1. 新增報名多選：搜尋、點選 2-3 位學生出現 chip、移除其中一位、選課程與堂數、送出，確認列表出現對應筆數、toast 訊息正確；刻意選一位已報名過的學生混在其中，確認部分成功/失敗的 toast 文字正確且成功的那幾筆有建立。
  2. 已報名列表任一行點「編輯」→ 開出的 Modal 裡調整每月堂數覆寫並儲存，確認 Modal 不關閉、列表數字更新；點「停用」確認 Modal 關閉、該行狀態變成已停用；再點「編輯」→「啟用」還原。
  3. 同一行「編輯」→「預約」→ 選一般 → 月曆挑時段送出 → 確認 `AdminBookingModal` 關閉、外層編輯 Modal 仍開著、該行本月狀態數字更新、`/admin/tutoring/bookings` 當日預約總覽看得到這筆。
  4. 同一行「編輯」→「預約」→ 切到補課 → 確認缺席紀錄下拉抓得到資料、選一筆送出 → 確認狀態直接是已預約（行政建立的補課會自動核准，這是既有後端行為，不是這次改的範圍，只是搬到新位置後要重新確認一次）。
  5. 「編輯」→「移除」確認二次確認彈窗、成功後編輯 Modal 關閉、該行從列表消失。
  6. 確認 `/admin/tutoring/bookings` 頁面「新增預約」卡片已經消失，當日預約總覽表、當月出席總表、返回鍵都正常運作。

## 不在這次範圍內

- 預約（訂哪天哪個時段）本身不做多學生批次——使用者已明確表示「報名每個時段只要單一操作就好」。
- 不新增/修改任何後端 API 或 service 函式。
- 不改變補課自動核准、容量檢查等既有商業邏輯。
- 「額度覆寫」的儲存邏輯（`saveQuotaOverride`）本身不變，這次只是把輸入框從表格欄位搬進編輯 Modal。
