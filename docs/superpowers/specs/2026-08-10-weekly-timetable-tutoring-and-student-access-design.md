# 週課表加入個別輔導時段＋開放學生端瀏覽

## 背景與目標

行政端 `/admin/classes` 頁面的「週課表」彈窗（`TimetableModal.tsx`）目前只顯示班級（`Class`）的每週固定時段，個別輔導（`TutoringProgram`／`TutoringWindow`）的時段完全沒有出現在這張表上——即使行政已經在 `/admin/tutoring` 建了「MPM」「普拉斯」等個別輔導課程並排好每週開放時段，週課表上還是看不到。使用者要求週課表要把這些個別輔導時段也顯示出來，而且要能自動涵蓋未來新增的課程，不侷限於目前這兩個名字。

同時，週課表目前是行政專屬功能（頁面與 API 都是 ADMIN-only）。使用者希望學生帳號也能看到同一張週課表（全校範圍，不是只顯示自己報名的部分）。

## 決定（已與使用者確認）

1. 個別輔導時段要顯示在週課表上，範圍是**所有現有／未來的個別輔導課程**（不侷限於 MPM、普拉斯），停用中的課程／時段不顯示。
2. 視覺區分：每個個別輔導**課程名稱**當作一個「科目」加進現有「科目顏色」系統——沿用同一套色票／圖例／`色塊調整`介面，行政可以像設定班級科目顏色一樣幫 MPM、普拉斯設定顏色。
3. 班級卡片右側那條「等級」顯色垘，個別輔導卡片**不顯示**（個別輔導沒有等級概念，硬塞一個沒意義）。
4. 個別輔導卡片**不可點擊**（班級卡片點下去會開「編輯班級」彈窗；個別輔導窗口編輯在另一個頁面 `/admin/tutoring`，目前沒有深連結到特定時段的機制，不勉強做）。
5. 學生端看到的週課表是**全校所有班級＋個別輔導時段**，跟行政看到的內容一樣，不是「只顯示自己報名的班級」那種個人化版本。
6. 實作方式：把週課表的「星期列 × 卡片網格」畫法抽成共用元件，行政與學生共用；另外新建一支任何登入角色都能呼叫的共用 API，只回傳排課需要的欄位（不含其他學生的報名/堂數資料）。

## 範圍

**這次改的：**
- 新檔 `src/lib/services/timetableService.ts`：新增 `listClassesForTimetable()`、`listTutoringSlotsForTimetable()` 兩個 service function
- 新檔 `src/app/api/timetable/route.ts`：`GET /api/timetable`，任何已登入角色可呼叫
- `src/app/api/subject-colors/route.ts`：`GET` 的角色檢查從「僅 ADMIN」放寬成「任何已登入角色」；`POST` 不動，維持 ADMIN-only
- 新檔 `src/components/timetable/WeeklyTimetableGrid.tsx`：把 `TimetableModal.tsx` 現有的星期列×卡片網格畫法搬過來，改成自己抓資料、支援班級＋個別輔導兩種卡片
- `src/app/admin/classes/TimetableModal.tsx`：瘦身成 `<Modal>` 外框＋色塊調整面板，內部改塞 `WeeklyTimetableGrid`
- `src/app/admin/classes/page.tsx`：呼叫 `TimetableModal` 的地方不再傳 `classes`，只傳 `onClassClick`
- 新檔 `src/app/student/timetable/page.tsx`：學生端週課表頁面
- `src/components/ui/AppShell.tsx`：`STUDENT` 導覽列加一個「週課表」連結

**不改的：** `/api/classes`（各角色既有的回傳邏輯不動，尤其學生角色「只回自己報名的班級」是給 `leave-request` 頁面用的，此次不動）、`/api/tutoring-programs`（行政管理個別輔導課程/時段的既有 CRUD 不動）、`Class`／`TutoringProgram`／`TutoringWindow` 的資料庫結構不動、`src/lib/timetable.ts` 既有的顏色/文字處理 helper（`stripWeekday`／`levelColor`／`MORANDI_PALETTE`／`UNSET_SUBJECT_COLOR`）沿用不動。

## 資料層設計

### `listClassesForTimetable()`（`src/lib/services/timetableService.ts`）

```ts
export function listClassesForTimetable() {
  return prisma.class.findMany({
    select: {
      id: true,
      name: true,
      subject: true,
      level: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
}
```

刻意不選 `enrollments`——週課表只需要畫格子，不需要知道哪些學生報了哪堂課，這個投影對任何角色都是安全的。

### `listTutoringSlotsForTimetable()`（同檔）

```ts
export interface TutoringSlotForTimetable {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

export async function listTutoringSlotsForTimetable(): Promise<TutoringSlotForTimetable[]> {
  const programs = await prisma.tutoringProgram.findMany({
    where: { active: true },
    select: {
      name: true,
      windows: {
        where: { active: true },
        select: {
          id: true,
          weekday: true,
          startTime: true,
          endTime: true,
          teacher: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });
  return programs.flatMap((p) => p.windows.map((w) => ({ ...w, programName: p.name })));
}
```

### `GET /api/timetable`（`src/app/api/timetable/route.ts`）

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listClassesForTimetable, listTutoringSlotsForTimetable } from '@/lib/services/timetableService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [classes, tutoringSlots] = await Promise.all([listClassesForTimetable(), listTutoringSlotsForTimetable()]);
  return NextResponse.json({ classes, tutoringSlots });
}
```

不分角色，任何已登入使用者（ADMIN／TEACHER／STUDENT）都能拿到同一份資料——這正是使用者要的「學生看到的跟行政一樣，全校範圍」。

### `GET /api/subject-colors` 角色放寬

現有實作把 `session.user.role !== 'ADMIN'` 擋掉非 ADMIN；改成 `!session` 才擋（任何登入角色都能讀）。`POST`（改色）維持原本的 ADMIN 檢查不動。

## 元件架構

### `WeeklyTimetableGrid.tsx`（新檔，`src/components/timetable/`）

```tsx
interface WeeklyTimetableGridProps {
  colors: Record<string, string>;
  onClassClick?: (id: string) => void;
}

export default function WeeklyTimetableGrid({ colors, onClassClick }: WeeklyTimetableGridProps) {
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [tutoringSlots, setTutoringSlots] = useState<TutoringSlotForTimetable[]>([]);

  useEffect(() => {
    fetch('/api/timetable')
      .then((res) => res.json())
      .then((data) => {
        setClasses(data.classes);
        setTutoringSlots(data.tutoringSlots);
      });
  }, []);

  // 依星期分組，班級與個別輔導各自帶一個 kind 標記方便渲染時分流
  const byDay = useMemo(() => {
    const days: Array<Array<{ kind: 'class'; data: TimetableClass } | { kind: 'tutoring'; data: TutoringSlotForTimetable }>> =
      Array.from({ length: 7 }, () => []);
    for (const c of classes) days[c.weekday].push({ kind: 'class', data: c });
    for (const t of tutoringSlots) days[t.weekday].push({ kind: 'tutoring', data: t });
    for (const day of days) day.sort((a, b) => a.data.startTime.localeCompare(b.data.startTime));
    return days;
  }, [classes, tutoringSlots]);

  // 科目圖例＝班級科目 + 個別輔導課程名稱，去重
  const subjects = useMemo(
    () => Array.from(new Set([...classes.map((c) => c.subject), ...tutoringSlots.map((t) => t.programName)])),
    [classes, tutoringSlots]
  );

  // ...渲染邏輯從 TimetableModal 搬過來：
  // - kind === 'class'：沿用現有卡片（科目上色＋等級色塊＋可點擊視 onClassClick 是否傳入）
  // - kind === 'tutoring'：科目上色（用 programName 當 key 查 colors），無等級色塊，
  //   卡片本體不包在 <button> 裡（不可點擊），內容顯示 programName / 時間 / 老師姓名
}
```

`colors`（科目色票 map）跟色塊調整 UI 留在呼叫端（`TimetableModal` 或未來任何包裝者），因為那是「誰能改色」這個權限問題，不屬於純顯示元件的責任；`WeeklyTimetableGrid` 只負責用拿到的 `colors` 上色、抓資料、畫格子。

### `TimetableModal.tsx`（瘦身）

保留 `<Modal>` 外框、色塊調整按鈕與面板（呼叫 `GET /api/subject-colors` 拿現有色票、`POST` 改色，這段邏輯不變，只是要拿到目前的科目清單改成從 `WeeklyTimetableGrid` 內部算出的 `subjects` 往上「抬」給父層知道——簡單做法：`colors` 的 fetch/state 留在 `TimetableModal`，`subjects` 清單的計算搬進 `WeeklyTimetableGrid`，色塊調整面板需要的 `subjects` 清單透過 `WeeklyTimetableGrid` 的一個 `onSubjectsChange?: (subjects: string[]) => void` callback 往上回報）。`TimetableModal` 不再接收 `classes` prop，改成：

```tsx
<Modal open={open} onClose={onClose} title="週課表" maxWidthClassName="max-w-5xl">
  {/* 科目圖例 + 色塊調整按鈕/面板，用 colors + subjects state */}
  <WeeklyTimetableGrid colors={colors} onClassClick={onClassClick} onSubjectsChange={setSubjects} />
</Modal>
```

### `/admin/classes/page.tsx`

`<TimetableModal open={showTimetable} onClose={...} onClassClick={...} />`——拿掉 `classes={classes}` 這個 prop（`WeeklyTimetableGrid` 自己抓）。頁面本身的 `classes` state／`/api/classes` fetch 不變，那是給班級列表＋編輯班級彈窗用的，跟週課表脫鉤。

## 學生端

新頁面 `src/app/student/timetable/page.tsx`：

```tsx
'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import WeeklyTimetableGrid from '@/components/timetable/WeeklyTimetableGrid';

export default function StudentTimetablePage() {
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch('/api/subject-colors')
      .then((res) => res.json())
      .then((rows: { subject: string; color: string }[]) => setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color]))));
  }, []);
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">週課表</h1>
      <Card>
        <WeeklyTimetableGrid colors={colors} />
      </Card>
    </>
  );
}
```

不傳 `onClassClick`（班級卡片純顯示，不可點擊）、沒有色塊調整按鈕（那段 UI 只存在於 `TimetableModal`，學生頁面完全不引入）。科目顏色是唯讀顯示，跟行政設定好的共用同一份。

`AppShell.tsx` 的 `NAV_LINKS.STUDENT` 陣列加一筆：`{ href: '/student/timetable', label: '週課表' }`（放在「個別輔導」後面，跟班級/課程相關的項目相鄰）。

## 邊界情況

- 停用中的班級目前 `Class` model 沒有 `active` 欄位（一直都是全部顯示），這次不新增，維持現況；個別輔導則是 program 或 window 任一 `active: false` 就不出現在週課表（即使該 window 底下還有未來的預約，也是純粹的「顯示」問題，不影響既有預約資料本身）。
- 個別輔導課程目前沒有 windows（剛建立、還沒排時段）：`listTutoringSlotsForTimetable()` 自然回傳空陣列，該課程不會佔用任何格子，也不會出現在科目圖例（圖例是從實際排出來的 `tutoringSlots` 算 `programName`，不是從 `TutoringProgram` 全表算）。
- 同一個時段同時有班級與個別輔導：兩張卡片都會出現在同一個星期格子裡，依 `startTime` 排序，跟現有班級卡片彼此重疊時的處理方式一致（垂直堆疊，不特別合併）。
- 學生／老師登入時色塊調整按鈕不存在，看到的科目顏色如果行政還沒設定過（`colors[subject]` 是 `undefined`），跟現有行為一致：用 `UNSET_SUBJECT_COLOR` 灰色兜底，不會噴錯。

## 測試計畫

後端（`src/**/*.test.ts`，照專案慣例）：
- `timetableService.test.ts`：`listClassesForTimetable()` 回傳的物件不含 `enrollments` 欄位；`listTutoringSlotsForTimetable()` 只回傳 `active` 的 program／window，停用的不出現，且正確攤平成 `{programName, weekday, startTime, endTime, teacher}` 的形狀。
- `api/timetable/route.test.ts`：未登入 401；ADMIN／TEACHER／STUDENT 三種角色都能拿到 200 與資料（不因角色不同而有差異）。
- `api/subject-colors/route.test.ts`：既有的 ADMIN 專屬測試不動，新增 STUDENT／TEACHER 呼叫 `GET` 回 200 的案例；`POST` 仍對非 ADMIN 回 403（既有行為不變，補一個回歸測試）。

前端：這個專案沒有 component test 慣例，一律瀏覽器手動驗證：
1. 行政登入 `/admin/classes` 點「週課表」，確認班級卡片跟之前一樣（可點擊開編輯、科目色＋等級垘），MPM／普拉斯等個別輔導時段也出現在對應星期格子（科目色、無等級垘、點了沒反應），色塊調整面板科目清單同時涵蓋班級科目與個別輔導課程名稱，設色後兩種卡片都套用新色。
2. 學生登入 `/student`，導覽列出現「週課表」，點進去確認跟行政看到的內容一致（全校班級＋個別輔導），沒有色塊調整按鈕，卡片都不可點擊。
3. 確認 `/admin/classes` 頁面本身的班級新增／編輯／刪除功能不受影響（`classes` state 與週課表資料脫鉤後的回歸測試）。

## 不在這次範圍內

- 個別輔導卡片的點擊互動（深連結到 `/admin/tutoring` 特定時段）——目前技術上做不到深連結，維持不可點擊。
- 學生端「只顯示自己相關」的個人化課表——使用者明確要全校範圍，個人化版本不在此次範圍。
- 老師帳號的週課表存取——這次只處理學生端，老師是否也要看到沒有被提出，不動老師導覽列。
- `Class` model 補上 `active` 欄位／停用機制——現況本來就沒有，這次不新增。
