# 櫃檯自助報到（條碼掃描）— 設計文件

日期：2026-07-28

## 背景與目標

現有點名系統（見 [`2026-07-27-attendance-system-design.md`](2026-07-27-attendance-system-design.md)）由老師/行政手動選場次、逐一點名，並明確把「學生自行簽到裝置」列為範圍外。這份文件把該項目重新納入範圍：學校櫃檯有一台電腦＋條碼掃描器，學生進門時用現成的學生證/校園卡（上面已印有學號條碼）自行掃描，系統要自動判斷「這是他今天哪一堂課」並記錄簽到／簽退，行政人員全程不需要選任何欄位或點擊。

掃描器是標準 USB/藍牙「鍵盤模擬」型（掃到什麼就當作打字輸入，最後送出 Enter），不需要額外驅動或瀏覽器權限。

## 範圍外（Out of Scope）

- 弈廳、活動報到 — 這兩種場次的點名維持現有人工流程，不納入本次自助報到
- 學號批次匯入／條碼列印 — 學號沿用學校既有卡片上的號碼，行政人員在學生編輯頁手動輸入登記，一次一位
- 聲音/硬體回饋（嗶聲燈號）— 僅靠螢幕上的視覺回饋
- 多語系、離線模式、非管理員登入的公開頁面 — 此頁面仍是 `/admin` 底下的一般頁面，用行政人員自己的登入狀態

## 資料模型

`Student` 新增一個欄位：

```prisma
model Student {
  ...
  studentNumber String? @unique
  ...
}
```

- 可為空（尚未登記學號的學生不受影響，既有點名流程照舊）
- 唯一（避免兩個學生對到同一組條碼）
- 純字串，不做格式驗證（英數混合，各校格式不一，比照 `Class.startTime` 等既有欄位「不驗證，信任輸入」的慣例）
- **空字串必須正規化成 `null`，不能直接存 `''`**：`/admin/students` 表單留空時送出的是 `''` 不是 `undefined`，而 Prisma 只把 `undefined` 當作「維持不變／不寫入」，`''` 是一個會真的寫進 DB 的值。這個欄位是 `@unique`，如果把 `''` 直接存進去，全系統只有第一個「沒填學號」的學生存得進去，第二個（包括後續編輯任何一個舊生、沒動這個欄位）都會撞到唯一約束，錯誤地顯示「此學號已被使用」。`createStudent`/`updateStudent` 收到 `studentNumber` 時要先 `?.trim() || null` 再寫入。

行政人員在 `/admin/students` 的新增/編輯表單上，新增一個「學號」文字輸入框，跟姓名、帳號等欄位並列。這格本身沒有特殊行為——用滑鼠點進去打字，或把游標放進去用掃描器掃一次卡把號碼帶入，效果一樣，都只是一般文字輸入。

## 比對邏輯

新增 `checkInByStudentNumber(code, now, markedById)` 服務函式，行為如下：

1. **找學生**：用 `studentNumber = code` 查 `Student`。查無此人 → 回傳 `NOT_FOUND`。
2. **列出今天候選場次**（沿用 `getClassRoster`／`listAttendanceSessionsForDate` 已有的查詢邏輯，不重新發明）：
   - 班級課：該學生的 `ClassEnrollment` 中，`Class.weekday` 等於今天星期幾；加上今天核准的插班補課（`MakeupRequest` type=INSERTION, status=APPROVED, targetDate=今天, 且該生的請假單）
   - 一對一補課：今天核准的 `MakeupRequest`（type=ONE_ON_ONE, status=APPROVED, slotDate=今天）且屬於該學生
   - **排除當天已核准請假的班級**：該學生對某班today有 `LeaveRequest`（`studentId` + `date` 相符即算，`LeaveRequest` 建立時就是 `status=APPROVED`，沒有待審狀態）的，該班級課候選直接排除，不進入後續比對。理由：請假的班級如果還被自動掃進候選，一旦在時間窗內被誤配對，會把 `ON_LEAVE`（不計堂數）誤標成 `PRESENT`（計堂數），多扣一堂課的額度。插班補課的「目標班級」如果剛好也在排除清單裡，同樣排除（避免跟一筆已存在的 `ON_LEAVE` 紀錄在同一個 `classId+studentId+date` 上衝突）；一對一補課不受影響，因為它本身就是「請假後的替代場次」，沒有自己的班級可以對到排除清單。
3. **依現有點名紀錄把候選分成三層，同一時間只看最優先、非空的那一層**（查每個候選場次現有的 `ClassAttendance`／`OneOnOneAttendance` 紀錄）：
   - **第一層（已簽到、尚未簽退）**：`checkInTime` 已填且 `checkOutTime` 未填。這是「正在進行中」的場次，簽退動作**不受時間窗限制**（下課時間本來就可能離上課時間超過 60 分鐘，例如兩小時的課）。此層有候選就直接用最接近的一個，動作是簽退，不再往下看。
   - **第二層（尚未簽到，且在時間窗內）**：`checkInTime` 未填，且「現在時間」與場次開始時間相差在 60 分鐘以內（不分前後）。此層有候選就用最接近的一個，動作是新簽到。**這一層存在的意義：學生完成了今天第一堂課的簽到簽退後，還能正常簽到第二堂課**——如果沒有這一層、只看「有沒有已完成的場次」，會被第一堂課的舊紀錄卡住，永遠簽不進第二堂課。
   - **第三層（已簽到也已簽退）**：`checkInTime`、`checkOutTime` 都已填。只有前兩層都沒有候選時才會落到這裡，效果是把簽退時間覆寫成最新的掃描時間（例如同一堂課下課後又多掃了一次）。
   - 三層都沒有候選 → 回傳 `NO_SESSION`。
   - 每一層內如果同時有多個候選（理論上少見），取時間差最小的一個，避免任意挑選。
4. **依決定的動作寫入**（`ClassAttendance` 或 `OneOnOneAttendance`，依場次類型，key 對應現有規則：插班用 `makeupRequestId`，本班用 `classId+studentId+date`，一對一用 `makeupRequestId`）：
   - 新簽到（第二層）→ upsert：`status=PRESENT`, `checkInTime=now`（"HH:mm"), `markedById`。回傳 `CHECKED_IN`。
   - 簽退（第一、三層）→ 更新 `checkOutTime=now`（覆寫成最新時間，`status` 不變）。回傳 `CHECKED_OUT`。
5. 回傳內容一律附上場次標題（班名或「一對一補課」）與時間，供前端顯示。

`markedById` 一律填「目前登入的行政帳號」——雖然是學生自己掃的，但沿用現有欄位語意（誰的帳號完成了這筆紀錄）。

## API

`POST /api/attendance/checkin`

- 權限：僅 `ADMIN`（比照其他點名 API）
- Body：`{ code: string }`
- Response：`{ result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT', studentName?: string, sessionTitle?: string, time?: string }`
- 不做 rate limit／防重放，信任這是內部櫃檯機器

## 介面設計

新頁面 `/admin/attendance/checkin`，全螢幕、大字級，設計重點是「不用選任何東西，掃了就有反應」：

- 頁面上有一個文字輸入框，樣式上不做成一般表單欄位的樣子（例如做成沒有可見邊框、融入背景，或直接用 `opacity:0` + 固定 focus），但**功能上是聚焦的**：進頁面自動 focus，`onBlur` 之後用 `setTimeout` 重新 focus 回去，確保掃描器隨時能把字打進來，行政人員不需要用滑鼠點任何東西。
- 監聽輸入框的 Enter（掃描器結尾送出的按鍵），觸發送出：呼叫 `POST /api/attendance/checkin`，然後清空輸入框、重新 focus。
- 結果顯示：畫面中央一個大區塊，依 API 回傳結果顯示：
  - `CHECKED_IN` → 綠色，「✓ {studentName} 已簽到 {time} — {sessionTitle}」
  - `CHECKED_OUT` → 綠色（跟簽到同色——兩者都是「成功」，只有真正的問題才用紅色；現場測試時試過藍色，看起來像是出了狀況，改回綠色），「✓ {studentName} 已簽退 {time} — {sessionTitle}」
  - `NOT_FOUND` → 紅色，「查無此學號，請洽行政人員」
  - `NO_SESSION` → 紅色，「找不到可報到的課程，請洽行政人員」
  - API 回傳非預期格式或非 2xx（例如管理員登入過期）→ 獨立的紅色錯誤訊息，不能落到跟 `NO_SESSION` 同一句話，否則整天沒人發現櫃檯機器早就停止記錄
  - 閒置狀態（尚未掃描/顯示逾時後）→ 灰色提示「請將學生證放在掃描器前」
- 結果顯示 4 秒後自動淡出、回到閒置狀態，準備下一位學生掃描；期間輸入框持續可接收下一次掃描（不用等淡出才能再掃）。
- 從既有 `/admin/attendance` 頁面（`AttendanceHub` 所在頁）新增一個「櫃檯報到模式」按鈕連到這個新頁面；新頁面右上角保留一個「返回」連結回 `/admin/attendance`（不放完整導覽列，維持全螢幕的簡潔）。

## 測試

- `checkInByStudentNumber` 走既有 Vitest + 真實測試資料庫慣例，覆蓋：查無學號、時間窗外、班級課簽到、班級課簽退（覆寫時間）、一對一補課簽到、插班補課場次比對。
- API 路由與頁面比照本專案慣例（零路由測試、零元件測試），靠 `tsc --noEmit` + `npx eslint` + 瀏覽器手動驗證。
