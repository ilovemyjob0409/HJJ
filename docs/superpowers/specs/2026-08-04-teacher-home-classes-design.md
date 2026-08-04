# 老師首頁「我的帶班班級」設計

2026-08-04。需求來源：老師帳號應該要在首頁可以看到自己的帶班班級。
定位：班級名單入口（點班級看學生名單），非純資訊一覽、非視覺課表。

## 畫面

### 首頁區塊
- 位置：TEACHER 首頁（`src/app/teacher/page.tsx`）三個捷徑卡之後、「被指派代課」之前。
- 標題「我的帶班班級」，內容為既有 `DataTable` 風格表格，欄位：
  - 班級：`Class.name`
  - 時段：`週X HH:MM–HH:MM`（weekday 轉「週日／週一…週六」＋ startTime–endTime）
  - 人數：`N 人`（enrollments 數）
- 排序：weekday asc、startTime asc（與 `listClasses` 一致）。
- 點任一列開啟該班學生名單彈窗；表格下方一行灰字提示「點任一列開啟該班學生名單」。
- 空狀態：無帶班時區塊不隱藏，Card 內顯示灰字「尚無帶班班級」（DataTable 沒有內建空資料樣式，
  比照 `teacher/go-hall` 的「尚無學生報名」灰字慣例）；彈窗內若該班無學生，同樣顯示灰字「尚無學生」。

### 學生名單彈窗
- 重用既有 `Modal` 元件。標題：`{班名} 學生名單`；副標（灰字）：`週X HH:MM–HH:MM・共 N 人`。
- 表格兩欄：
  - 學生：姓名
  - 堂數進度：`{usedSessions}／{totalSessions} 堂`；`totalSessions === null` 時只顯示 `{usedSessions} 堂`。
- 快結堂提示：`remaining !== null && remaining <= 2` 的學生，於彈窗表格下方列出
  「⚠ {姓名} 剩 {remaining} 堂」（多人逐行，`remaining` 為 0 或負值時照實顯示），
  供老師提醒續報；沒有符合者則不顯示。
- 名單排序：依姓名（zh-TW locale）。

## 技術設計

### 資料流（無新 API）
- 新 service：`classService.listClassesForTeacher(teacherId)`
  - `prisma.class.findMany({ where: { teacherId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] })`
  - 每班 enrollments 帶學生姓名，並沿用 `listClasses` 的 pattern 以
    `getClassEnrollmentQuota(classId, studentId)` 補上 `totalSessions／usedSessions／remaining`。
  - select 僅取所需欄位（班名、weekday、時間、學生 id＋姓名＋quota），不含家長聯絡資訊。
- `teacher/page.tsx` 是 server component：與現有四個查詢並列，teacher 存在時一併
  `listClassesForTeacher(teacher.id)`，把結果 props 傳給新 client component。
- 新 client component `TeacherClassList`（`src/components/`）：
  - 收 serialized rows，渲染表格＋管理彈窗開關 state。
  - 資料已隨 SSR 帶入，彈窗開啟不再打 API。

### 權限
- 只查 `teacherId` 等於登入老師的班級；頁面既有邏輯已從 session 解析 teacher，未登入／非老師時區塊顯示空表格（與現有四組資料的 fallback 一致）。

### 顯示細節
- 週幾標籤：把 `dateFormat.ts` 的 `WEEKDAY_LABELS` 加上 `export`，`TeacherClassList` 直接重用（日一二三四五六），不另造陣列。
- 動效：無新動畫；彈窗與表格沿用既有元件行為（[[feedback-motion-conventions]]）。

## 測試（service 層，沿用真實測試 DB pattern）
`classService.test.ts` 新增 `listClassesForTeacher`：
1. 只回傳該老師的班級（他師班級不出現）。
2. 排序 weekday asc、startTime asc。
3. enrollment 帶正確 quota（含 `totalSessions null` 的情況）。
4. 無帶班回傳空陣列。

UI 為薄殼（表格＋彈窗開關），不另寫元件測試，與專案慣例一致。

## 明確不做（YAGNI）
- 不做週課表視覺（admin `TimetableModal` 不重構）。
- 彈窗不放點名、出缺勤摘要、聯絡資訊。
- 不新增 API endpoint。
