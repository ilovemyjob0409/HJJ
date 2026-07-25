# 活動封面縮圖 ＋ 上傳裁切 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 活動列表（管理員/老師/學生，含學生「我的報名紀錄」）都顯示第一張照片當封面縮圖；上傳照片時（新增活動表單／既有相簿）先跳出固定 1:1 裁切畫面。

**Architecture:** 後端在既有的 activity 查詢 select 裡多帶一張最早的照片，統一用一個 `attachCoverUrl` 輔助函式簽出網址、攤平成 `coverUrl: string | null`，三支既有 API route 完全不用改（它們只是把 service 回傳值直接 `NextResponse.json`）。前端新增一個可重用的 `ImageCropModal`（用 `react-easy-crop`），插在兩個既有的「選檔案」入口之前，選完檔案先逐張裁切，裁切完的方形 Blob 才進既有的壓縮/暫存/上傳流程。

**Tech Stack:** Next.js 14 App Router、Prisma、`react-easy-crop`（新依賴）、既有的 Supabase Storage 簽名網址機制、vitest。

**Spec:** `docs/superpowers/specs/2026-07-25-activity-photo-cover-and-crop-design.md`

## Global Constraints

- 封面縮圖：40×40（`h-10 w-10`）、`rounded object-cover`；無照片顯示 `bg-stripe` 灰色佔位方塊，同尺寸。
- 裁切固定 1:1，`react-easy-crop` 的 `aspect={1}`；裁切完仍要跑過既有的 `compressImage`（最長邊 2000px、JPEG 0.85）才送出，不繞過既有的檔案大小保證。
- 裁切逐張處理：多選 N 張，依序跳出 N 次裁切畫面；「跳過這張」＝不裁切、不進入後續流程，直接處理下一張；全部處理完（含跳過）才把結果陣列交回呼叫端。
- `compressImage`／`uploadActivityImageFile` 參數型別從 `File` 放寬為 `Blob`（`File extends Blob`，既有呼叫點不用改）。
- 三支既有的 activities API route（`/api/activities`、`/api/activities/[id]`、`/api/activity-registrations`）**不需要修改**——`coverUrl` 完全在 service 層算好。
- Commit 格式：`feat:`/`fix:`/`chore:` 前綴 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` footer。
- Worktree 環境：從主 checkout 複製 `.env`（含 SUPABASE_* 與本機 DATABASE_URL）。
- 測試指令：`npm test`（本機測試庫可能被其他並行 session 干擾出現間歇性 FK 錯誤——這是已知問題，重跑一次或改跑單一測試檔確認即可，不要花時間追）；lint `npm run lint`；型別 `npx tsc --noEmit`。

---

### Task 1: Service 層——三個 list + detail 查詢帶封面網址

**Files:**
- Modify: `src/lib/services/activityService.ts`
- Modify: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Produces：`listAllActivities()`、`listActivitiesForTeacher(teacherId)`、`listOpenActivitiesForStudent()`、`getActivityDetail(id)` 回傳的每筆活動物件都多一個欄位 `coverUrl: string | null`（不再有 `images` 欄位，已被 `attachCoverUrl` 攤平掉）。`listRegistrationsForStudent(studentId)` 回傳的 `{id, activity}[]`，其中 `activity.coverUrl` 同樣存在。
- Consumes：`src/lib/storage.ts` 既有的 `createSignedUrls(paths: string[]): Promise<Map<string, string>>`（已存在，該檔案本身不用改）。

- [ ] **Step 1: 寫失敗測試（擴充既有檔案）**

`src/lib/services/activityService.test.ts` 檔案頂部的 `vi.mock('@/lib/storage', ...)` 已經正確 mock 了 `createSignedUrls`（回傳 `https://signed/${path}` 格式），不用改。在檔案最後新增一個 describe 區塊：

```ts
describe('coverUrl on list/detail queries', () => {
  it('returns null coverUrl for an activity with no images', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const activity = await createActivity({
      title: '無照片活動',
      description: 'd',
      categoryId: camp.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacher.id],
    });

    const [all] = await listAllActivities();
    expect(all.coverUrl).toBeNull();

    const detail = await getActivityDetail(activity.id);
    expect(detail.coverUrl).toBeNull();
  });

  it('returns the earliest-uploaded image as a signed coverUrl, and omits the raw images field', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const activity = await createActivity({
      title: '有照片活動',
      description: 'd',
      categoryId: camp.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacher.id],
    });
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/1.jpg` } });
    await new Promise((r) => setTimeout(r, 5)); // ensure distinct createdAt ordering
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/2.jpg` } });

    const [all] = await listAllActivities();
    expect(all.coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);
    expect((all as unknown as { images?: unknown }).images).toBeUndefined();

    const forTeacher = await listActivitiesForTeacher(teacher.id);
    expect(forTeacher[0].coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);

    const open = await listOpenActivitiesForStudent();
    expect(open[0].coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);

    const detail = await getActivityDetail(activity.id);
    expect(detail.coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);

    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x', parentPhone: '' });
    await prisma.activityRegistration.create({ data: { activityId: activity.id, studentId: student.id } });
    const registrations = await listRegistrationsForStudent(student.id);
    expect(registrations[0].activity.coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: 新增的兩個測試 FAIL（`coverUrl` 現在是 `undefined`，因為 select 還沒加 `images`）；其餘既有測試仍 PASS。

- [ ] **Step 3: 實作**

`src/lib/services/activityService.ts` 頂部 import 增加：

```ts
import { createSignedUrls, deleteActivityImages } from '@/lib/storage';
```

（原本只 import `deleteActivityImages`，改成同時 import `createSignedUrls`。）

兩個 select 常數都加一行（放在 `_count` 之前或之後皆可，這裡放在 `teachers` 之後）：

```ts
  images: { orderBy: { createdAt: 'asc' as const }, take: 1, select: { storagePath: true } },
```

`ACTIVITY_LIST_SELECT` 完整變成：

```ts
const ACTIVITY_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: { select: { name: true } },
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  images: { orderBy: { createdAt: 'asc' as const }, take: 1, select: { storagePath: true } },
  registrations: {
    select: {
      id: true,
      studentId: true,
      student: { select: { user: { select: NAME_ONLY_SELECT } } },
    },
  },
  _count: { select: { registrations: true } },
} as const;
```

`ACTIVITY_STUDENT_LIST_SELECT` 完整變成：

```ts
const ACTIVITY_STUDENT_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: { select: { name: true } },
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  images: { orderBy: { createdAt: 'asc' as const }, take: 1, select: { storagePath: true } },
  _count: { select: { registrations: true } },
} as const;
```

在兩個 select 常數之後、`CreateActivityInput` 之前，新增共用輔助函式：

```ts
async function attachCoverUrl<T extends { images: { storagePath: string }[] }>(
  rows: T[],
): Promise<(Omit<T, 'images'> & { coverUrl: string | null })[]> {
  const paths = rows.map((r) => r.images[0]?.storagePath).filter((p): p is string => !!p);
  const urls = paths.length ? await createSignedUrls(paths) : new Map<string, string>();
  return rows.map(({ images, ...rest }) => ({
    ...rest,
    coverUrl: images[0] ? (urls.get(images[0].storagePath) ?? null) : null,
  }));
}
```

把以下四個函式改成 `async`，並在回傳前套用 `attachCoverUrl`：

```ts
export async function listAllActivities() {
  const rows = await prisma.activity.findMany({
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
  return attachCoverUrl(rows);
}

export async function listActivitiesForTeacher(teacherId: string) {
  const rows = await prisma.activity.findMany({
    where: { teachers: { some: { teacherId } } },
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
  return attachCoverUrl(rows);
}

export async function listOpenActivitiesForStudent() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await prisma.activity.findMany({
    where: { endDate: { gte: today } },
    select: ACTIVITY_STUDENT_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
  return attachCoverUrl(rows);
}
```

（`listAllActivities` 與 `listActivitiesForTeacher` 原本用的是 `ACTIVITY_LIST_SELECT`，`listOpenActivitiesForStudent` 用 `ACTIVITY_STUDENT_LIST_SELECT`——維持不變，只是加上 `attachCoverUrl` 這一步。）

`getActivityDetail` 改成：

```ts
export async function getActivityDetail(id: string) {
  const activity = await prisma.activity.findUniqueOrThrow({
    where: { id },
    select: ACTIVITY_LIST_SELECT,
  });
  const [withCover] = await attachCoverUrl([activity]);
  return withCover;
}
```

`listRegistrationsForStudent` 改成（`activity` 是巢狀欄位，要攤平出來單獨跑 `attachCoverUrl` 再組回去）：

```ts
export async function listRegistrationsForStudent(studentId: string) {
  const rows = await prisma.activityRegistration.findMany({
    where: { studentId },
    select: {
      id: true,
      activity: { select: ACTIVITY_STUDENT_LIST_SELECT },
    },
    orderBy: { activity: { startDate: 'desc' } },
  });
  const activitiesWithCover = await attachCoverUrl(rows.map((r) => r.activity));
  return rows.map((r, i) => ({ id: r.id, activity: activitiesWithCover[i] }));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: 全部 PASS（含既有測試——確認沒有因為 select 多了 `images` 欄位而弄壞既有斷言，既有測試都是用 `expect(row).toMatchObject({...})` 或個別欄位斷言，不會因為多一個欄位就壞掉；如果有用整物件 `toEqual` 比對導致失敗，屬於預期內的更新，把該筆期望值也加上 `coverUrl: null` 或對應簽名網址）。

- [ ] **Step 5: 全域型別檢查**

Run: `npx tsc --noEmit`
Expected: 乾淨（`attachCoverUrl` 的泛型約束要能通過 `ACTIVITY_LIST_SELECT`／`ACTIVITY_STUDENT_LIST_SELECT` 兩種 shape，若型別報錯，檢查 `Omit<T, 'images'>` 與呼叫端型別是否對齊，必要時把 `attachCoverUrl` 的回傳型別交給 TS 自行推導，不手動标註）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: attach signed cover photo url to activity list and detail queries"
```

---

### Task 2: 前端——三個角色列表加封面縮圖欄

**Files:**
- Modify: `src/app/admin/activities/page.tsx`
- Modify: `src/app/student/activities/page.tsx`
- Modify: `src/app/teacher/activities/page.tsx`

**Interfaces:**
- Consumes：Task 1 的 `coverUrl: string | null`。

- [ ] **Step 1: `admin/activities/page.tsx`**

`ActivityRow` interface 加一行：

```ts
interface ActivityRow {
  id: string;
  coverUrl: string | null;
  title: string;
  ...
```

`columns` 陣列最前面（`{ header: '標題', ... }` 之前）插入：

```tsx
{
  header: '封面',
  render: (a) =>
    a.coverUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
      <img src={a.coverUrl} alt="封面" className="mx-auto h-10 w-10 rounded object-cover" />
    ) : (
      <div className="bg-stripe mx-auto h-10 w-10 rounded" />
    ),
},
```

- [ ] **Step 2: `student/activities/page.tsx`**

`ActivityStudentRow` interface 加 `coverUrl: string | null;`（`RegistrationRow.activity: ActivityStudentRow` 會自動繼承這個欄位，不用改 `RegistrationRow`）。

`openColumns` 陣列最前面插入跟 Step 1 一樣的「封面」欄（`render: (a) => ...`，`a` 型別是 `ActivityStudentRow`）。

`myColumns` 陣列最前面也插入一欄，`render: (r) => r.activity.coverUrl ? <img ...> : <div ...>`（欄位邏輯相同，只是資料路徑多一層 `r.activity.`）。

- [ ] **Step 3: `teacher/activities/page.tsx`**

`ActivityRow` interface 加 `coverUrl: string | null;`。`columns` 陣列最前面插入跟 Step 1 一樣的「封面」欄。

- [ ] **Step 4: 驗證**

Run: `npm run lint && npx tsc --noEmit`
Expected: 乾淨。（瀏覽器實測留到 Task 5 整體驗證一起做。）

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/activities/page.tsx src/app/student/activities/page.tsx src/app/teacher/activities/page.tsx
git commit -m "feat: show cover photo thumbnail column in all three activity list views"
```

---

### Task 3: 裁切基礎建設——`react-easy-crop`、`cropImage.ts`、`ImageCropModal`

**Files:**
- Modify: `package.json`（新依賴）
- Create: `src/lib/cropImage.ts`
- Modify: `src/lib/imageCompression.ts`
- Modify: `src/lib/uploadActivityImage.ts`
- Create: `src/components/ImageCropModal.tsx`

**Interfaces:**
- Produces：
  - `getCroppedImageBlob(file: File, area: PixelCrop): Promise<Blob>`（`cropImage.ts`）
  - `<ImageCropModal files={File[]} onDone={(blobs: Blob[]) => void} />`（`files` 為空陣列時不 render 任何東西；呼叫端負責在 `onDone` 裡把自己的 state 清空，不然同一個 `files` 陣列會一直觸發）
  - `compressImage(blob: Blob): Promise<Blob>`（型別放寬，行為不變）
  - `uploadActivityImageFile(activityId: string, blob: Blob): Promise<boolean>`（型別放寬，行為不變）

- [ ] **Step 1: 安裝依賴**

Run: `npm install react-easy-crop`
Expected: 安裝成功，`package.json` dependencies 出現該套件（目前最新版是 6.x）。

- [ ] **Step 2: 放寬 `imageCompression.ts` 與 `uploadActivityImage.ts` 的參數型別**

`src/lib/imageCompression.ts` 第 8 行 `export async function compressImage(file: File): Promise<Blob> {` 改成：

```ts
export async function compressImage(file: Blob): Promise<Blob> {
```

（函式內容不變——`createImageBitmap`、`canvas` 操作對 `Blob`／`File` 一視同仁。）

`src/lib/uploadActivityImage.ts` 的 `uploadActivityImageFile` 簽名：

```ts
export async function uploadActivityImageFile(activityId: string, file: Blob): Promise<boolean> {
```

（函式內容不變。）

- [ ] **Step 3: `src/lib/cropImage.ts`**

```ts
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function getCroppedImageBlob(file: File, area: PixelCrop): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('圖片載入失敗'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('裁切失敗');
    ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('裁切失敗'))), 'image/jpeg', 0.95),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: `src/components/ImageCropModal.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { getCroppedImageBlob } from '@/lib/cropImage';

interface ImageCropModalProps {
  files: File[];
  onDone: (croppedBlobs: Blob[]) => void;
}

export default function ImageCropModal({ files, onDone }: ImageCropModalProps) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Blob[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const currentFile = files[index];

  useEffect(() => {
    setIndex(0);
    setResults([]);
  }, [files]);

  useEffect(() => {
    if (!currentFile) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(currentFile);
    setImageUrl(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  useEffect(() => {
    if (files.length > 0 && index >= files.length) {
      onDone(results);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, files.length]);

  if (files.length === 0 || !currentFile || !imageUrl) return null;

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    try {
      const blob = await getCroppedImageBlob(currentFile, croppedAreaPixels);
      setResults((prev) => [...prev, blob]);
    } catch {
      // 裁切失敗視同跳過這張，不中斷佇列
    }
    setIndex((i) => i + 1);
  }

  function handleSkip() {
    setIndex((i) => i + 1);
  }

  return (
    <Modal open onClose={handleSkip} title={`裁切照片（${index + 1}/${files.length}）`}>
      <div className="relative h-72 w-full overflow-hidden rounded-lg bg-black">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          aspect={1}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
        />
      </div>
      <input
        type="range"
        min={1}
        max={3}
        step={0.01}
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
        className="mt-3 w-full"
        aria-label="縮放"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={handleSkip}>
          跳過這張
        </Button>
        <Button type="button" onClick={handleConfirm}>
          確認裁切
        </Button>
      </div>
    </Modal>
  );
}
```

注意事項給實作者：
- `files` 這個 prop 每次呼叫端要開新一輪裁切時，**必須傳一個新的陣列參考**（例如 `Array.from(fileList)`），這樣第一個 `useEffect`（依賴 `files`）才會正確重置 `index`/`results`；不要重用同一個陣列物件再 mutate。
- `onDone` 會在 `index` 推進到 `files.length` 時觸發一次；呼叫端在 `onDone` 裡要把自己儲存 `files` 的 state 設回空陣列（例如 `setCropQueue([])` 或 `null`），否則這個 modal 會維持在「已結束但 files 還在」的殘留狀態（`files.length > 0 && index >= files.length` 這個 effect 依賴 `files.length` 不依賴 `files` 本身，如果呼叫端沒清空，`files.length` 不變，effect 不會重複觸發，屬於安全的一次性行為，但畫面上 modal 也不會再開，因為 `index >= files.length` 時 `currentFile` 是 `undefined`，`if (files.length === 0 || !currentFile ...) return null;` 會擋掉——沒有殘留 UI 問題，只是提醒呼叫端還是要清空 state 才能供下一輪重新選檔案用）。

- [ ] **Step 5: 驗證**

Run: `npm run lint && npx tsc --noEmit`
Expected: 乾淨。`react-easy-crop` 的 `Area` type export 需確認存在（若型別報錯找不到 `Area`，改用 `import Cropper, { Point, Area } from 'react-easy-crop'` 或查該套件實際的型別匯出名稱調整，功能不變）。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/cropImage.ts src/lib/imageCompression.ts src/lib/uploadActivityImage.ts src/components/ImageCropModal.tsx
git commit -m "feat: add square image crop modal backed by react-easy-crop"
```

---

### Task 4: 接入兩個上傳入口

**Files:**
- Modify: `src/app/admin/activities/page.tsx`
- Modify: `src/components/ActivityAlbum.tsx`

**Interfaces:**
- Consumes：Task 3 的 `<ImageCropModal>`、`compressImage(Blob)`、`uploadActivityImageFile(activityId, Blob)`。

- [ ] **Step 1: `admin/activities/page.tsx`——新增活動表單的暫存照片**

加 import：

```ts
import ImageCropModal from '@/components/ImageCropModal';
```

加 state（跟 `stagedPhotos` 放一起）：

```ts
const [cropQueue, setCropQueue] = useState<File[]>([]);
```

`handleStagePhotos` 整個函式改成：

```ts
function handleStagePhotos(files: FileList | null) {
  if (!files || files.length === 0) return;
  setCropQueue(Array.from(files));
  if (stagedFileInputRef.current) stagedFileInputRef.current.value = '';
}

async function handleCroppedPhotos(blobs: Blob[]) {
  setCropQueue([]);
  for (const blob of blobs) {
    try {
      const compressed = await compressImage(blob);
      setStagedPhotos((prev) => [...prev, { blob: compressed, previewUrl: URL.createObjectURL(compressed) }]);
    } catch {
      showToast('有照片壓縮失敗');
    }
  }
}
```

（原本 `handleStagePhotos` 直接 `compressImage(file)`；現在改成先進裁切佇列，裁切完的 blob 陣列在 `handleCroppedPhotos` 裡才逐一壓縮暫存——壓縮邏輯本身不變，只是輸入源從 `File` 換成裁切後的 `Blob`。）

在 JSX 的照片選取按鈕區塊之後（`</div>` 結束「照片（選填）」那個 `<div>` 之後、`{formError && ...}` 之前，或任何 return 的頂層皆可，Modal 本身有自己的 fixed 定位不受父層佈局影響）加：

```tsx
<ImageCropModal files={cropQueue} onDone={handleCroppedPhotos} />
```

- [ ] **Step 2: `ActivityAlbum.tsx`——既有相簿的上傳**

加 import：

```ts
import ImageCropModal from '@/components/ImageCropModal';
```

加 state：

```ts
const [cropQueue, setCropQueue] = useState<File[]>([]);
```

`handleFiles` 改名為選檔案階段，新增裁切完成後的處理函式：

```ts
function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  setCropQueue(Array.from(files));
  if (fileInputRef.current) fileInputRef.current.value = '';
}

async function handleCroppedPhotos(blobs: Blob[]) {
  setCropQueue([]);
  if (blobs.length === 0) return;
  setUploading(true);
  try {
    let failed = 0;
    for (const blob of blobs) {
      const ok = await uploadActivityImageFile(activityId, blob);
      if (!ok) failed += 1;
    }
    showToast(failed === 0 ? '照片已上傳' : `有 ${failed} 張上傳失敗`);
    setLoading(false);
    await load();
  } finally {
    setUploading(false);
  }
}
```

（原本 `handleFiles` 是「選檔案就直接壓縮上傳」的完整流程；現在拆成「選檔案→進裁切佇列」與「裁切完成→逐一上傳」兩段。`fileInputRef` 的 `onChange` 改呼叫新的 `handleFiles`，其餘 `<input>` 定義不變。）

在元件最外層 `<div className="flex flex-col gap-2">...</div>` 結束之後（或內部任一位置，Modal 有自己的 fixed 定位）加：

```tsx
<ImageCropModal files={cropQueue} onDone={handleCroppedPhotos} />
```

- [ ] **Step 3: 驗證**

Run: `npm run lint && npx tsc --noEmit`
Expected: 乾淨。

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/activities/page.tsx src/components/ActivityAlbum.tsx
git commit -m "feat: crop photos before staging or uploading in the activity photo flows"
```

---

### Task 5: 全站驗證矩陣 + 收尾

**Files:** 無（除非驗證發現問題）

- [ ] **Step 1: 全域檢查**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: 全部乾淨/綠（`npm test` 若因共用測試庫的已知間歇性 FK 碰撞失敗，重跑一次；若還是失敗，改跑 `npx vitest run src/lib/services/activityService.test.ts` 確認本次改動涉及的測試檔本身是綠的）。

- [ ] **Step 2: 瀏覽器實測（worktree、本機 dev DB，勿連正式庫）**

1. 三個角色（admin/teacher/student）的活動列表：確認每列最前面有「封面」欄——沒照片的活動顯示灰色方塊，有照片的活動顯示縮圖，深淺色主題都看一次。
2. 學生「我的報名紀錄」表格同樣有封面欄。
3. 管理員新增活動：選 3 張照片，確認依序跳出 3 次裁切畫面（標題顯示「裁切照片（1/3）」→「（2/3）」→「（3/3）」），可拖曳圖片、拉縮放滑桿；其中 1 張按「跳過這張」，其餘 2 張「確認裁切」；送出後確認活動列表封面正確、相簿裡只有 2 張（不是 3 張）、縮圖是方形且對齊使用者選的裁切區域。
4. 既有活動的「編輯」→ 相簿「＋ 上傳照片」：選 2 張，走一樣的裁切流程，確認上傳成功、封面欄（如果這是該活動第一張照片）正確更新。
5. 深淺色主題下裁切 Modal 本身（背景遮罩、按鈕）視覺正常。

- [ ] **Step 3: 清理測試資料**

瀏覽器實測建立的活動/照片，用直接查 DB＋呼叫 `deleteActivityImages` 的方式清乾淨（比照先前 Album 驗證階段的做法），確認 `activityImage`／`activity` 計數歸零、Storage 對應路徑也清空。

- [ ] **Step 4: 回報**

完成後回報，等使用者用 Safari 對正式站實測（尤其是裁切拖曳在觸控裝置上的手感）後再收尾。
