# 個別輔導模組（英文／數學）設計

日期：2026-08-07

## 背景與目標

英文／數學是一對多個別輔導（一位老師同時帶多位學生各自進度），沒有課程進度問題。現況：學生每週來兩次、日子不固定、一個月收費一次；但現有系統的 `Class` 是「固定星期幾＋固定時段」的固定班，學生換天上課就要走請假＋調課兩道手續，行政負擔大。

目標：建立獨立的「個別輔導」模組——每週固定重複的開放時段（大窗口）、家長／學生自選日期與起訖時間預約、同時在座容量控管、按日曆月追蹤次數、缺席計次並走補課申請。**完全不動現有 Class／請假／補課／調課系統**，架構比照已驗證的弈廳模式。

## 資料模型（全部新增，Prisma）

```prisma
model TutoringProgram {          // 輔導課程（英文個別輔導／數學個別輔導…通用）
  id                     String  @id @default(cuid())
  name                   String
  defaultMonthlyQuota    Int     @default(8)    // 每月預設額度
  defaultDurationMinutes Int     @default(120)  // 預約預設時長
  active                 Boolean @default(true)
  windows     TutoringWindow[]
  enrollments TutoringEnrollment[]
}

model TutoringWindow {           // 每週重複的開放窗口
  id        String  @id @default(cuid())
  programId String
  program   TutoringProgram @relation(fields: [programId], references: [id])
  weekday   Int              // 0-6
  startTime String           // "16:00"
  endTime   String           // "21:00"
  capacity  Int              // 同時在座人數上限
  teacherId String
  teacher   Teacher @relation(fields: [teacherId], references: [id])
  active    Boolean @default(true)
  closures  TutoringWindowClosure[]
  bookings  TutoringBooking[]
}

model TutoringWindowClosure {    // 特定日期停開（國定假日、寒暑假）
  id       String   @id @default(cuid())
  windowId String
  window   TutoringWindow @relation(fields: [windowId], references: [id], onDelete: Cascade)
  date     DateTime // UTC 日曆日
  @@unique([windowId, date])
}

model TutoringEnrollment {       // 學生 × 課程
  id                     String  @id @default(cuid())
  programId              String
  program                TutoringProgram @relation(fields: [programId], references: [id])
  studentId              String
  student                Student @relation(fields: [studentId], references: [id])
  monthlyQuota           Int?    // null＝用課程預設；行政可個別覆寫（月中入學、個案結轉）
  active                 Boolean @default(true)
  lastQuotaReminderMonth String? // "2026-08"，月中提醒防重複
  bookings               TutoringBooking[]
  @@unique([programId, studentId])
}

enum TutoringBookingKind   { REGULAR MAKEUP }
enum TutoringBookingStatus { PENDING_ADMIN BOOKED CANCELLED_LATE REJECTED }

model TutoringBooking {          // 一筆預約：日期＋自選起訖時間
  id           String   @id @default(cuid())
  enrollmentId String
  enrollment   TutoringEnrollment @relation(fields: [enrollmentId], references: [id])
  windowId     String
  window       TutoringWindow @relation(fields: [windowId], references: [id])
  date         DateTime // UTC 日曆日
  startTime    String   // 30 分鐘刻度，需落在窗口內
  endTime      String
  kind         TutoringBookingKind   @default(REGULAR)
  status       TutoringBookingStatus @default(BOOKED)
  makeupForId  String?  @unique      // MAKEUP 專用：補哪一筆計次紀錄（一筆只能補一次）
  makeupFor    TutoringBooking? @relation("MakeupFor", fields: [makeupForId], references: [id])
  makeupChild  TutoringBooking? @relation("MakeupFor")
  createdAt    DateTime @default(now())
  attendance   TutoringAttendance?
}

model TutoringAttendance {       // 沿用現有 AttendanceStatus
  id           String  @id @default(cuid())
  bookingId    String  @unique
  booking      TutoringBooking @relation(fields: [bookingId], references: [id])
  status       AttendanceStatus
  checkInTime  String?
  checkOutTime String?
  markedById   String
  markedBy     User    @relation(fields: [markedById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

`Student`、`Teacher`、`User` 各加對應的反向關聯欄位。

## 核心規則

### 容量（同時在座）

預約送出時，把起訖時間切成 30 分鐘小段，逐段計算該窗口當日已存在預約（status 為 `BOOKED` 或 `PENDING_ADMIN`）的重疊人數；任何一段達到 `capacity` 就拒絕並提示改時間。學生端顯示每半小時剩餘名額的視覺化長條輔助選擇。

### 取消與補課（分界點：前一天 23:59，台北時間）

- **前一天 23:59 前取消**：直接刪除預約（比照弈廳報名），名額釋出、不計次、免手續。
- **當天取消**：預約標記 `CANCELLED_LATE`，計次。
- **缺席**（點名標 ABSENT）：預約保留，計次。
- **補課申請**：計次但沒上到的預約（`CANCELLED_LATE` 或出席為 ABSENT），家長可在學生端申請補課——選新日期＋時段（過容量檢查），建立 `kind=MAKEUP`、`status=PENDING_ADMIN` 的新預約並以 `makeupForId` 關聯原預約；行政核准→`BOOKED`，駁回→`REJECTED`（紀錄保留）。核准後的補課堂**不計次**。每筆計次紀錄只能補一次（`makeupForId` unique）。
- 待核准的補課預約先佔容量，避免核准時已無名額。

### 月次數（日曆月，每月 1 號歸零）

一筆 `REGULAR` 預約在「日期當天 00:00（台北）」鎖定，鎖定後不論到場、遲到、當天取消、缺席都計入該月次數；`MAKEUP` 不計次。當天仍可臨時預約（成立即鎖定計次）。首頁卡片顯示「8月：已計次/額度」（如 5/8），預約頁顯示完整「已計次 X／未鎖定預約 Y／額度 Q」。超過額度仍可預約，但提示「本月已達 Q 堂，多上的堂數行政將另行結算」（月費制不硬擋）。

### 月底未用完

預設歸零，不自動結轉。配套：

- **月中提醒**：每月 20 號（Vercel Cron，台北時間上午，路由以 `CRON_SECRET` 保護），對「已用＋已預約 < 額度」且已綁 LINE 的學生推播「本月還剩 N 堂未預約」；`lastQuotaReminderMonth` 防重複。
- **行政個案結轉**：行政認為情有可原時，用額度覆寫工具把下月 `monthlyQuota` 調高（例如 8→11），屬個案善意處理，非自動權利。

## 學生端

- 學生首頁新增「個別輔導」卡片：每個已報名課程一列，顯示「8月：5/8 堂」進度條（沿用現有堂數進度條樣式），點入預約頁。
- 預約頁 `/student/tutoring`：
  - 未來 14 天可預約日清單（由窗口自動產生，排除 closure），每天展開顯示每半小時剩餘名額長條，選起訖時間（預設帶 `defaultDurationMinutes`）。
  - 我的預約清單：未鎖定的可直接取消／改期；已計次未上的顯示「申請補課」按鈕；補課申請顯示狀態徽章（沿用 StatusBadge）。
  - 表格類紀錄沿用 CollapsibleDataTable（>3 筆收合）、日期顯示「日期（星期）」。

## 老師端與點名整合

- **AttendanceHub**：`listAttendanceSessionsForDate` 增加 `TUTORING` 場次類型——當日有預約的窗口出現一列，打開是當日預約學生名單（各自起訖時間、補課徽章），照常標到／遲到／早退／缺席。臨時上門沒預約的學生，老師／行政可現場補加（建立當日預約＋出席，補加的預約一樣計次）。
- **自助刷學號簽到**：`checkInByStudentNumber` 的候選清單加入當日輔導預約（`BOOKED`，含核准的補課），簽到標 PRESENT、簽退記時間，LINE 簽到通知沿用現有格式。

## 行政端 `/admin/tutoring`

- 課程與窗口維護（CRUD、特定日期停開、容量與老師調整）。
- 學生報名管理：把學生加入課程、個別月額度覆寫、停用。
- 預約總覽：依日期看各窗口預約，可代預約、代取消（行政取消可選計次或不計次，處理特殊個案）。
- 補課申請佇列：核准／駁回。
- 當月出席總表：每位學生 已上／當天取消／缺席／補課 統計，附 ExportCsvButton CSV 匯出。

## 邊界與不做的事

- 輔導科目不接請假／補課／調課／代課系統；「沒來」的處理全部在本模組內（取消、計次、補課申請）。
- 日期慣例照舊：UTC 日曆日儲存與比較、「今天」以台北時間判定、顯示 `formatDateWithWeekday`。
- 預約成功／取消不發 LINE 通知（先不做，需要再加）；只有簽到通知與月中額度提醒。
- 現有英文／數學固定班不自動遷移：模組上線後行政手動把學生報名進輔導課程，舊班確認無未結紀錄後手動下架，兩套短暫並行。
- 收費本身不進系統，系統只提供次數對帳資料。

## 測試重點

- 容量重疊計算：邊界（頭尾相接不算重疊）、跨段、滿員拒絕、`PENDING_ADMIN` 佔位。
- 取消分界：前一天 23:59（台北）前後行為、時區換算。
- 月次數：鎖定時點、`CANCELLED_LATE`／ABSENT 計次、MAKEUP 不計次、跨月歸零、額度覆寫。
- 補課鏈：一筆只能補一次、核准／駁回狀態流轉。
- 點名與自助簽到候選整合、現場補加。
- Cron 提醒：條件篩選、防重複、未綁 LINE 略過。

## 上線步驟

1. Prisma migration（純新增表，無現有資料影響）＋ production SQL 存 `docs/superpowers/`。
2. Vercel 環境變數加 `CRON_SECRET`，`vercel.json` 加 cron 設定。
3. 行政建課程與窗口 → 報名學生 → 學生端開放。
4. **更新使用手冊**：`/guide` 學生使用教學頁補「個別輔導預約」章節（預約、取消改期、補課申請、月額度說明），並重產 PDF（`docs/manual/學生帳號使用手冊.pdf`；截圖須用最新 main＋zh-TW locale，方法見 memory `project_student_guide`）。
