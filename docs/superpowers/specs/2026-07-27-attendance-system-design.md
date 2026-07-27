# 點名系統（簽到簽退）— 設計文件

日期：2026-07-27

## 背景與目標

現有系統涵蓋請假、補課、代課、Go Hall、活動報名，但完全沒有「出席」概念——沒有人記錄學生某天到底有沒有來上課。目標是新增一套**點名（簽到簽退）系統**，涵蓋四種上課/活動場合：

1. 固定班級的每堂課
2. 補課（插班、一對一）
3. Go Hall 場次
4. 活動 (Activity)

老師／行政代為點名（不做學生自行簽到的裝置/QR 流程）。同時新增「堂數」機制：學生在某班級的在籍（`ClassEnrollment`）可設定一季總堂數，點名時自動累計已上/剩餘，並反映到學生帳號端。

## 範圍外（Out of Scope）

- 學生／家長自行簽到裝置（QR、平板 kiosk）——一律由老師/行政操作
- 主動推播通知（LINE/簡訊/Email）——沿用系統一貫「登入後自行查看」原則
- 排課引擎／自動產生每日堂次資料——`Class` 仍只有星期＋時間樣板，`ClassAttendance` 用 `(classId, date)` 代表「當天這堂課」，不新建堂次實體
- 出席紀錄的版本歷史／審計軌跡——PATCH 為 upsert，只保留最後一次結果與 `markedBy`/`updatedAt`，不做完整 audit log
- 堂數的自動計算（依季度/星期推算應排幾堂）——`totalSessions` 由行政人工輸入固定數字，系統只做「已上/剩餘」的加減

## 資料模型

### 新增四張出席表

```prisma
enum AttendanceStatus {
  PRESENT      // 出席
  LATE         // 遲到
  LEFT_EARLY   // 早退
  ON_LEAVE     // 請假
  ABSENT       // 缺席未請假
}

model ClassAttendance {
  id              String   @id @default(cuid())
  classId         String
  class           Class    @relation(fields: [classId], references: [id])
  studentId       String
  student         Student  @relation(fields: [studentId], references: [id])
  date            DateTime
  status          AttendanceStatus
  checkInTime     String?  // "14:32" 格式，比照 Class.startTime 慣例，自由文字不驗證
  checkOutTime    String?
  makeupRequestId String?  @unique  // 插班補課學生：指向來源申請；本班學生為 null
  makeupRequest   MakeupRequest? @relation(fields: [makeupRequestId], references: [id])
  markedById      String   // 操作者 User.id（老師或行政）
  markedBy        User     @relation(fields: [markedById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([classId, studentId, date])
}

model OneOnOneAttendance {
  // 只用於一對一補課（沒有 Class 可掛）；插班補課併入 ClassAttendance
  id              String   @id @default(cuid())
  makeupRequestId String   @unique
  makeupRequest   MakeupRequest @relation(fields: [makeupRequestId], references: [id])
  status          AttendanceStatus
  checkInTime     String?
  checkOutTime    String?
  markedById      String
  markedBy        User     @relation(fields: [markedById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model GoHallAttendance {
  id           String   @id @default(cuid())
  sessionId    String
  session      GoHallSession @relation(fields: [sessionId], references: [id])
  studentId    String
  student      Student  @relation(fields: [studentId], references: [id])
  status       AttendanceStatus
  checkInTime  String?
  checkOutTime String?
  markedById   String
  markedBy     User     @relation(fields: [markedById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([sessionId, studentId])
}

model ActivityAttendance {
  id           String   @id @default(cuid())
  activityId   String
  activity     Activity @relation(fields: [activityId], references: [id])
  studentId    String
  student      Student  @relation(fields: [studentId], references: [id])
  date         DateTime // 跨日活動每天各一筆
  status       AttendanceStatus
  checkInTime  String?
  checkOutTime String?
  markedById   String
  markedBy     User     @relation(fields: [markedById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([activityId, studentId, date])
}
```

### `ClassEnrollment` 新增堂數欄位

```prisma
model ClassEnrollment {
  id            String  @id @default(cuid())
  studentId     String
  classId       String
  student       Student @relation(fields: [studentId], references: [id])
  class         Class   @relation(fields: [classId], references: [id])
  totalSessions Int?    // 該學生在此班級本季總堂數，行政手動輸入；null = 不追蹤堂數

  @@unique([studentId, classId])
}
```

## 核心邏輯

### 為什麼插班補課不用獨立的表

一對一補課完全獨立於任何 `Class`（只有學生＋老師＋時段），必須另開 `OneOnOneAttendance`。但插班補課的學生，就是「某天坐進某個既有班級」——跟該班本來的學生沒有本質差異，只是名單的來源不同，所以直接寫進同一張 `ClassAttendance`，用 `makeupRequestId` 欄位標記來源即可，不重複建表。

### 某班某天的點名名單怎麼組成

1. 該班 `ClassEnrollment` 的所有在籍學生（`makeupRequestId = null`）
2. 加上：當天 `targetDate` 符合、`targetClassId` 符合此班、`status = APPROVED`、`type = INSERTION` 的 `MakeupRequest`（`makeupRequestId` 指向該筆申請）
3. 對於第 1 類學生，若當天有 `LeaveRequest`（`studentId` + `classId` + `date` 符合），畫面預設狀態帶入「請假」，老師仍可手動改掉

### 堂數計算規則

- **已上** = `count(ClassAttendance WHERE classId, studentId, status != ON_LEAVE)`
- **剩餘** = `totalSessions - 已上`（`totalSessions` 為 null 時不顯示已上/剩餘）
- **請假不扣堂**：因為請假後學生會走補課流程另外補一堂，若請假也扣堂，補課出席又不會歸還這堂額度，等於扣兩次
- **缺席未請假要扣堂**：若不扣堂，學生會覺得「乾脆不請假直接翹掉」比照樣請假更划算（一样保留額度還不用填單），失去逼學生事前請假的誘因
- 插班補課寫入的是**目標班級**的 `ClassAttendance`（不影響學生自己原班的已上/剩餘計算），天然分開不用特判

### 一對一補課、Go Hall、活動——不套用堂數

`totalSessions`/已上/剩餘只存在於 `ClassEnrollment`，其餘三種場合沒有「在籍」概念，不適用堂數，只有單純的出席狀態記錄。

## API 層

沿用既有 `getServerSession` + inline role 檢查慣例：

- `GET /api/attendance/sessions?date=` — 當天（或指定日）四類場次清單（ADMIN 看全部；TEACHER 僅自己教的），每筆含「已點名/總人數」
- `GET /api/attendance/class/:classId?date=` — 該班該天名單（含已上/剩餘、請假預帶、插班併入）
- `POST /api/attendance/class/:classId` — body `{ date, records: [{studentId, status, checkInTime?, checkOutTime?, makeupRequestId?}] }`，批次 upsert 進 `ClassAttendance`
- `GET/POST /api/attendance/one-on-one/:makeupRequestId` — 單一學生的一對一補課出席
- `GET/POST /api/attendance/go-hall/:sessionId` — 名單來自 `GoHallRegistration`
- `GET/POST /api/attendance/activity/:activityId?date=` — 名單來自 `ActivityRegistration`
- `GET /api/attendance/me` — 學生查自己的紀錄（跨四張表彙整，依日期排序）
- `GET /api/attendance/stats?studentId=|classId=&from=&to=` — 行政統計用彙總（各狀態次數）
- `classIds` 陣列改為 `{ classId, totalSessions? }[]`：擴充 `PATCH /api/students/:id`（或既有 enrollments 端點）讓行政同時設定堂數；`setStudentEnrollments` 對「維持勾選未變動」的既有 enrollment 也要更新 `totalSessions`（不只新增/刪除時處理）

權限：ADMIN 全開；TEACHER 僅限「班級/場次/補課的老師欄位是自己」，不符合回 403；日期缺漏/格式錯回 400。

## UI 層

- **Nav**：ADMIN、TEACHER 新增「點名」項目（`/admin/attendance`、`/teacher/attendance`）；STUDENT 新增「我的出席紀錄」（`/student/attendance`）
- **點名總覽**：日期選擇（預設今天）＋當天四類場次列表（班級／一對一補課／弈廳／活動），每筆顯示已點名進度，點入開名單
- **名單畫面**：學生列表，狀態 5 選一按鈕、簽到/簽退時間欄（選填）、請假自動預帶「請假」、插班學生自動出現且有標籤；班級類型的名單額外顯示「已上 X／共 Y 堂」（`totalSessions` 有設定才顯示）
- **行政統計頁**（`/admin/attendance` 內一個頁籤）：選學生或班級＋區間，顯示各狀態次數彙總表格
- **學生端**：
  - `/student` 首頁「我的班級」表格新增「剩餘堂數」欄（`totalSessions` 未設定則顯示 `-`）
  - 新增 `/student/attendance`「我的出席紀錄」頁，`DataTable` 列出四類出席紀錄（類型／日期／狀態／簽到簽退時間），依日期新到舊排序
- **行政班級/學生管理畫面**：學生的班級勾選清單，勾選的班級旁新增「堂數」數字輸入框（沿用既有 checkbox-list 編輯介面，非新頁面）

## 錯誤處理

- 非本人班級/場次/補課操作一律 403（比照既有 inline 角色檢查慣例）
- 日期缺漏或格式錯誤回 400
- PATCH/POST 為 upsert，可重複修正同一天的紀錄，`updatedAt`/`markedById` 只記最後一次操作，無版本歷史

## 測試

沿用「service 層測試、真實 db（`beforeEach` 依 FK 順序清表）、無 API route 測試」慣例：

- **名單合併**：班級名單正確合併在籍學生 + 當天核准插班，請假學生自動預帶「請假」狀態
- **upsert 語意**：同一天重複儲存會覆蓋既有紀錄而非產生重複列
- **堂數計算**：`totalSessions` 為 null 時不計算；請假不扣堂；缺席未請假扣堂；插班補課寫入目標班級不影響原班堂數
- **權限**：非任教老師操作回錯誤
- **統計彙總**：跨日期區間各狀態次數加總正確
- 完成後手動瀏覽器驗證：老師點名 → 學生「我的出席紀錄」看得到、「我的班級」剩餘堂數正確扣減 → 行政統計數字正確
