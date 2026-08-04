# 老師首頁「我的帶班班級」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TEACHER 首頁新增「我的帶班班級」表格，點班級開學生名單彈窗（姓名＋堂數進度＋快結堂提示）。

**Architecture:** 新 service `listClassesForTeacher(teacherId)` 在 server component（`teacher/page.tsx`）一次帶齊班級＋名單＋quota，props 傳給新 client component `TeacherClassList`（DataTable＋Modal），不新增 API endpoint。

**Tech Stack:** Next.js App Router（server/client components）、Prisma、vitest（真實測試 DB）、既有 UI 元件 `Card`／`DataTable`／`Modal`。

**Spec:** `docs/superpowers/specs/2026-08-04-teacher-home-classes-design.md`

## Global Constraints

- UI 文案一律繁體中文；commit message 用中文、結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 不新增任何 npm 依賴、不新增 API endpoint、不改 Prisma schema。
- 動效沿用既有元件內建行為（`animate-fade-in`／`animate-modal-in` 已在 DataTable、Modal 內），不另創動畫。
- select 不得帶出家長聯絡資訊（email／phone），只取姓名與堂數。
- 測試指令：`npx vitest run <file>`（測試 DB schema 未變，不需重跑 `npm run test:dbpush`；若整套跑 `npm test` 會自動 dbpush）。
- **不要在本機跑 `npm run build`**（別的 session 的 dev server 正在此資料夾運行，會互咬 `.next`）；型別把關用 `npx tsc --noEmit`，Vercel push 後自己會 build。

---

### Task 1: service `listClassesForTeacher`

**Files:**
- Modify: `src/lib/services/classService.ts`（在 `listClasses` 之後、`listClassesForBooking` 之前插入）
- Test: `src/lib/services/classService.test.ts`（檔尾新增 describe）

**Interfaces:**
- Consumes: `getClassEnrollmentQuota(classId, studentId)`（已 import 於 classService.ts，回傳 `{ totalSessions: number | null, usedSessions: number, remaining: number | null }`）
- Produces（Task 2 依賴，名稱型別須完全一致）:
  ```ts
  export interface TeacherClassStudent {
    studentId: string;
    name: string;
    totalSessions: number | null;
    usedSessions: number;
    remaining: number | null;
  }
  export interface TeacherClassSummary {
    id: string;
    name: string;
    weekday: number;
    startTime: string;
    endTime: string;
    students: TeacherClassStudent[];
  }
  export async function listClassesForTeacher(teacherId: string): Promise<TeacherClassSummary[]>
  ```

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/services/classService.test.ts` 檔尾新增（`listClassesForTeacher` 加進檔頭既有的 `from './classService'` import 清單）：

```ts
import { listClassesForTeacher } from './classService';

describe('listClassesForTeacher', () => {
  it('returns only that teacher classes, sorted by weekday then startTime', async () => {
    const teacher = await createTeacher({ name: '吳老師', email: 'tch-wu@example.com', password: 'x', subjects: '圍棋' });
    const other = await createTeacher({ name: '別師', email: 'tch-other@example.com', password: 'x', subjects: '圍棋' });
    await createClass({ name: '週四班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 4, startTime: '16:30', endTime: '18:30' });
    await createClass({ name: '週二晚班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '18:00', endTime: '20:00' });
    await createClass({ name: '週二午班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await createClass({ name: '他師班', subject: '圍棋', level: '基礎', teacherId: other.id, weekday: 1, startTime: '10:00', endTime: '12:00' });

    const rows = await listClassesForTeacher(teacher.id);
    expect(rows.map((r) => r.name)).toEqual(['週二午班', '週二晚班', '週四班']);
    expect(rows[0]).toMatchObject({ weekday: 2, startTime: '14:00', endTime: '16:00' });
  });

  it('includes each student with name and quota fields (incl. unlimited totalSessions)', async () => {
    const teacher = await createTeacher({ name: '吳老師', email: 'tch-quota@example.com', password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '週二班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    const s1 = await createStudent({ name: '王小明', email: 'tch-s1@example.com', password: 'x' });
    const s2 = await createStudent({ name: '林小華', email: 'tch-s2@example.com', password: 'x' });
    await prisma.classEnrollment.create({ data: { classId: cls.id, studentId: s1.id, totalSessions: 24 } });
    await enrollStudent(cls.id, s2.id);

    const [row] = await listClassesForTeacher(teacher.id);
    expect(row.students).toHaveLength(2);
    expect(row.students.find((s) => s.name === '王小明')).toMatchObject({
      studentId: s1.id, totalSessions: 24, usedSessions: 0, remaining: 24,
    });
    expect(row.students.find((s) => s.name === '林小華')).toMatchObject({
      totalSessions: null, usedSessions: 0, remaining: null,
    });
  });

  it('returns an empty array for a teacher with no classes', async () => {
    const teacher = await createTeacher({ name: '新老師', email: 'tch-new@example.com', password: 'x', subjects: '圍棋' });
    expect(await listClassesForTeacher(teacher.id)).toEqual([]);
  });
});
```

（`createTeacher`、`createStudent`、`createClass`、`enrollStudent`、`prisma` 檔頭已 import。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/classService.test.ts -t "listClassesForTeacher"`
Expected: FAIL —— `listClassesForTeacher` is not exported / not a function。

- [ ] **Step 3: 最小實作**

在 `src/lib/services/classService.ts` 的 `listClasses` 函式之後插入：

```ts
const TEACHER_CLASS_SELECT = {
  id: true,
  name: true,
  weekday: true,
  startTime: true,
  endTime: true,
  enrollments: {
    select: { studentId: true, student: { select: { user: { select: { name: true } } } } },
    orderBy: { student: { user: { name: 'asc' } } },
  },
} as const;

export interface TeacherClassStudent {
  studentId: string;
  name: string;
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

export interface TeacherClassSummary {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  students: TeacherClassStudent[];
}

// 老師首頁「我的帶班班級」：自己的班＋每位學生的堂數進度。
// 不帶老師/家長聯絡資訊；quota 語意同 getClassEnrollmentQuota（請假、未報名不扣堂）。
export async function listClassesForTeacher(teacherId: string): Promise<TeacherClassSummary[]> {
  const classes = await prisma.class.findMany({
    where: { teacherId },
    select: TEACHER_CLASS_SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  return Promise.all(
    classes.map(async (c) => ({
      id: c.id,
      name: c.name,
      weekday: c.weekday,
      startTime: c.startTime,
      endTime: c.endTime,
      students: await Promise.all(
        c.enrollments.map(async (e) => ({
          studentId: e.studentId,
          name: e.student.user.name,
          ...(await getClassEnrollmentQuota(c.id, e.studentId)),
        }))
      ),
    }))
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: 該檔全部 PASS（含既有測試）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts
git commit -m "feat: 老師首頁我的帶班班級——service listClassesForTeacher

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `TeacherClassList` 元件＋首頁接線

**Files:**
- Modify: `src/lib/dateFormat.ts:1`（`WEEKDAY_LABELS` 加 `export`）
- Create: `src/components/TeacherClassList.tsx`
- Modify: `src/app/teacher/page.tsx`

**Interfaces:**
- Consumes: Task 1 的 `listClassesForTeacher`／`TeacherClassSummary`／`TeacherClassStudent`；
  `Modal`（props：`open`、`onClose`、`title`、`children`、可選 `maxWidthClassName`）；
  `DataTable`（props：`columns`、`rows`、`keyField`、`onRowClick`、`rowClassName`）；`Card`。
- Produces: `<TeacherClassList classes={TeacherClassSummary[]} />`（default export）。

- [ ] **Step 1: 匯出 WEEKDAY_LABELS**

`src/lib/dateFormat.ts` 第 1 行：

```ts
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
```

- [ ] **Step 2: 建立 `src/components/TeacherClassList.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';
import type { TeacherClassSummary, TeacherClassStudent } from '@/lib/services/classService';

function timeLabel(c: TeacherClassSummary) {
  return `週${WEEKDAY_LABELS[c.weekday]} ${c.startTime}–${c.endTime}`;
}

export default function TeacherClassList({ classes }: { classes: TeacherClassSummary[] }) {
  const [viewing, setViewing] = useState<TeacherClassSummary | null>(null);

  const columns: Column<TeacherClassSummary>[] = [
    { header: '班級', render: (r) => r.name },
    { header: '時段', render: (r) => timeLabel(r) },
    { header: '人數', render: (r) => `${r.students.length} 人` },
  ];

  const studentColumns: Column<TeacherClassStudent>[] = [
    { header: '學生', render: (s) => s.name },
    {
      header: '堂數進度',
      render: (s) => (s.totalSessions === null ? `${s.usedSessions} 堂` : `${s.usedSessions}／${s.totalSessions} 堂`),
    },
  ];

  const lowQuota = viewing?.students.filter((s) => s.remaining !== null && s.remaining <= 2) ?? [];

  return (
    <Card className="mb-6">
      {classes.length === 0 ? (
        <p className="text-sm text-inkMuted">尚無帶班班級</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={classes}
            keyField={(r) => r.id}
            onRowClick={(r) => setViewing(r)}
            rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          />
          <p className="mt-2 text-xs text-inkMuted">點任一列開啟該班學生名單</p>
        </>
      )}
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={`${viewing?.name ?? ''} 學生名單`}>
        {viewing && (
          <>
            <p className="mb-3 text-sm text-inkMuted">
              {timeLabel(viewing)}・共 {viewing.students.length} 人
            </p>
            {viewing.students.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生</p>
            ) : (
              <DataTable columns={studentColumns} rows={viewing.students} keyField={(s) => s.studentId} />
            )}
            {lowQuota.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {lowQuota.map((s) => (
                  <p key={s.studentId} className="text-sm text-pending">
                    ⚠ {s.name} 剩 {s.remaining} 堂
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 3: 首頁接線 `src/app/teacher/page.tsx`**

三處修改：

檔頭 import 區加：

```ts
import { listClassesForTeacher } from '@/lib/services/classService';
import TeacherClassList from '@/components/TeacherClassList';
```

`Promise.all` 加第五個查詢（fallback 同步補一個空陣列）：

```ts
const [substitutes, leaves, insertions, goHallSessions, teacherClasses] = teacher
  ? await Promise.all([
      listAssignedSubstituteRequestsForTeacher(teacher.id),
      listLeaveRequestsForTeacherClasses(teacher.id),
      listInsertionsForTeacherClasses(teacher.id),
      listSessionsForTeacher(teacher.id),
      listClassesForTeacher(teacher.id),
    ])
  : [[], [], [], [], []];
```

JSX：在三個捷徑卡的 `</div>`（`className="mb-6 grid ..."` 那個 div 結尾）之後、`<h2 ...>被指派代課</h2>` 之前插入：

```tsx
<h2 className="mb-2 font-bold text-ink">我的帶班班級</h2>
<TeacherClassList classes={teacherClasses} />
```

（`TeacherClassList` 的 Card 自帶 `mb-6`，不用再包 div。）

- [ ] **Step 4: 型別與測試驗證**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/dateFormat.ts src/components/TeacherClassList.tsx src/app/teacher/page.tsx
git commit -m "feat: 老師首頁我的帶班班級——區塊表格＋學生名單彈窗

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 整體驗證＋部署

**Files:**
- 無新檔；只驗證與 push。

**Interfaces:**
- Consumes: Task 1–2 的全部產出。
- Produces: 部署到 Vercel 的正式站（無 schema 變更，**不需** production SQL）。

- [ ] **Step 1: 全套測試**

Run: `npm test`
Expected: 全部 PASS（2026-08-04 基準：390+ tests，Task 1 會再加 3 個）。

- [ ] **Step 2: 瀏覽器驗證（可選）**

若要目視確認：用 `preview_start`（launch.json 的 `hjj-dev`）開本 session 自己的 dev server 看 `/teacher`。
注意：老師頁需登入，無法登入時以測試通過＋型別乾淨為準，不阻擋部署。

- [ ] **Step 3: Push 部署**

```bash
git push origin main
```

Push 後用 `npx vercel ls` 確認最新 Production deployment 轉為 Ready（歷史建置約 1 分鐘）。
