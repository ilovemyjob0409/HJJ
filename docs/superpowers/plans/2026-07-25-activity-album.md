# 活動相簿（Activity Album）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每個活動一本相簿——ADMIN 上傳/刪除，所有登入者瀏覽；照片存 Supabase Storage 私有 bucket，以 1 小時簽名網址存取。

**Architecture:** 新增 `ActivityImage` 表與 server-only Supabase Storage 客戶端（`src/lib/storage.ts`）；三支 API（list/upload/delete）；共用 `ActivityAlbum` 前端元件（含瀏覽器端 canvas 壓縮）接進三個角色的活動詳情 Modal。刪除活動級聯刪照片。

**Tech Stack:** Next.js 14 App Router、Prisma（db push 慣例，無 migrations）、@supabase/supabase-js（新依賴，僅 server import）、vitest（本機 Postgres 測試庫）、既有動效系統。

**Spec:** `docs/superpowers/specs/2026-07-25-activity-album-design.md`

## Global Constraints

- `SUPABASE_SERVICE_ROLE_KEY` 只能在 server 端使用（`src/lib/storage.ts`、API route、service）；嚴禁出現在任何 `'use client'` 檔案或 `NEXT_PUBLIC_` 變數。
- Bucket `activity-images` 已存在（private、10MB、jpeg/png/webp）——不要在程式中建 bucket。
- API 上傳驗證：content-type ∈ {image/jpeg, image/png, image/webp} 且 ≤ 4MB（4_194_304 bytes）。
- 簽名網址效期 3600 秒。
- 動效沿用既有系統：`<Button loading>`、`.skeleton-shimmer`、`.animate-fade-in`；不新增動畫 CSS。
- pending 狀態一律 try/finally。
- Commit 格式：`feat:`/`fix:`/`chore:` 前綴 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` footer。
- Worktree 環境準備：從主 checkout 複製 `.env`（含 SUPABASE_* 與本機 DATABASE_URL）到 worktree，否則 dev server 與 Storage 呼叫都會失敗。
- 測試指令：`npm test`（會先 db push 到本機測試庫）；lint `npm run lint`；型別 `npx tsc --noEmit`。
- **上線順序（最終 task 的硬性約束）**：先對正式庫跑 `prisma db push`（新表為 additive、向後相容），再合併推送程式碼。

---

### Task 1: Schema — ActivityImage 表

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `prisma.activityImage`（欄位 id/activityId/storagePath/createdAt）、`Activity.images` 反向關聯。後續 Task 3/4 依賴。

- [ ] **Step 1: schema 加 model 與反向關聯**

`prisma/schema.prisma` — 在 `model Activity` 區塊內加一行關聯欄位：

```prisma
  images        ActivityImage[]
```

並在 `model Activity` 之後新增：

```prisma
model ActivityImage {
  id          String   @id @default(cuid())
  activityId  String
  activity    Activity @relation(fields: [activityId], references: [id])
  storagePath String
  createdAt   DateTime @default(now())
}
```

- [ ] **Step 2: 推到本機 dev 庫並重新生成 client**

Run: `npx prisma db push && npx prisma generate`
Expected: `Your database is now in sync`，無錯誤。

- [ ] **Step 3: 既有測試全綠（新表不影響舊行為）**

Run: `npm test`
Expected: 168/168 pass（`test:dbpush` 會把新表推進測試庫）。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: ActivityImage schema for per-activity photo albums"
```

---

### Task 2: Supabase Storage 客戶端（server-only）

**Files:**
- Create: `src/lib/storage.ts`
- Test: `src/lib/storage.test.ts`
- Modify: `package.json`（新增依賴）

**Interfaces:**
- Produces:
  - `uploadActivityImage(activityId: string, body: Buffer, contentType: string): Promise<string>`（回傳 storagePath，格式 `${activityId}/${cuid()}.jpg|png|webp`）
  - `createSignedUrls(paths: string[]): Promise<Map<string, string>>`（空陣列回空 Map；效期 3600s）
  - `deleteActivityImages(paths: string[]): Promise<void>`（空陣列直接 return）
- 環境變數缺失時，模組內 `getClient()` 第一次被呼叫就 throw `Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured')`。

- [ ] **Step 1: 安裝依賴**

Run: `npm install @supabase/supabase-js`
Expected: 安裝成功，package.json dependencies 出現該套件。

- [ ] **Step 2: 寫失敗測試**

`src/lib/storage.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadMock = vi.fn();
const createSignedUrlsMock = vi.fn();
const removeMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        createSignedUrls: createSignedUrlsMock,
        remove: removeMock,
      })),
    },
  })),
}));

beforeEach(() => {
  vi.resetModules();
  uploadMock.mockReset();
  createSignedUrlsMock.mockReset();
  removeMock.mockReset();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

describe('storage', () => {
  it('throws a clear error when env vars are missing', async () => {
    delete process.env.SUPABASE_URL;
    const { createSignedUrls } = await import('./storage');
    await expect(createSignedUrls(['a/b.jpg'])).rejects.toThrow(/not configured/);
  });

  it('uploadActivityImage uploads under the activity folder with the right extension and returns the path', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
    const { uploadActivityImage } = await import('./storage');
    const path = await uploadActivityImage('act123', Buffer.from('x'), 'image/jpeg');
    expect(path).toMatch(/^act123\/[0-9a-f-]+\.jpg$/);
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Buffer), { contentType: 'image/jpeg' });
  });

  it('uploadActivityImage throws when the storage API returns an error', async () => {
    uploadMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { uploadActivityImage } = await import('./storage');
    await expect(uploadActivityImage('a', Buffer.from('x'), 'image/png')).rejects.toThrow('boom');
  });

  it('createSignedUrls maps each path to its signed url and returns empty Map for empty input', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://signed/1' },
        { path: 'a/2.jpg', signedUrl: 'https://signed/2' },
      ],
      error: null,
    });
    const { createSignedUrls } = await import('./storage');
    const map = await createSignedUrls(['a/1.jpg', 'a/2.jpg']);
    expect(map.get('a/1.jpg')).toBe('https://signed/1');
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['a/1.jpg', 'a/2.jpg'], 3600);
    expect((await createSignedUrls([])).size).toBe(0);
  });

  it('deleteActivityImages removes the given paths and no-ops on empty input', async () => {
    removeMock.mockResolvedValue({ data: null, error: null });
    const { deleteActivityImages } = await import('./storage');
    await deleteActivityImages(['a/1.jpg']);
    expect(removeMock).toHaveBeenCalledWith(['a/1.jpg']);
    await deleteActivityImages([]);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: FAIL（storage.ts 不存在）。

- [ ] **Step 4: 實作 `src/lib/storage.ts`**

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BUCKET = 'activity-images';
const SIGNED_URL_TTL_SECONDS = 3600;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  client ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return client;
}

export async function uploadActivityImage(activityId: string, body: Buffer, contentType: string): Promise<string> {
  const ext = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  const path = `${activityId}/${randomUUID()}.${ext}`;
  const { error } = await getClient().storage.from(BUCKET).upload(path, body, { contentType });
  if (error) throw new Error(error.message);
  return path;
}

export async function createSignedUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl]));
}

export async function deleteActivityImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getClient().storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
```

檔名用 Node 內建 `crypto.randomUUID()`——不要為檔名新增任何依賴。

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: 5/5 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts package.json package-lock.json
git commit -m "feat: server-side Supabase Storage client for activity images"
```

---

### Task 3: activityImageService＋deleteActivity 級聯

**Files:**
- Create: `src/lib/services/activityImageService.ts`
- Test: `src/lib/services/activityImageService.test.ts`
- Modify: `src/lib/services/activityService.ts:120-126`（deleteActivity）
- Modify: `src/lib/services/activityService.test.ts`（beforeEach 加 activityImage 清理 + 級聯測試）

**Interfaces:**
- Consumes: Task 1 的 `prisma.activityImage`、Task 2 的 storage 函式。
- Produces:
  - `listImagesWithUrls(activityId): Promise<{ id: string; url: string; createdAt: Date }[]>`（createdAt asc；內部呼叫 `createSignedUrls`）
  - `addImage(activityId: string, storagePath: string)`（回傳完整 ActivityImage row）
  - `deleteImage(imageId: string): Promise<void>`（先刪 DB 後刪 Storage；Storage 失敗吞掉不 throw——孤兒檔案可接受，破圖不可接受）
  - `deleteActivity(id)`（activityService）改為：先查該活動全部 storagePath → transaction 內多刪 `activityImage.deleteMany` → transaction 成功後呼叫 `deleteActivityImages(paths)`（失敗吞掉）。

- [ ] **Step 1: 寫失敗測試**

`src/lib/services/activityImageService.test.ts`（沿用本 repo service 測試慣例：真 DB、mock storage）：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';

vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { createSignedUrls, deleteActivityImages } from '@/lib/storage';
import { listImagesWithUrls, addImage, deleteImage } from './activityImageService';
import { createActivity, deleteActivity } from './activityService';

async function makeActivity() {
  const teacher = await createTeacher({ name: '老師', email: `t${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
  const category = await prisma.activityCategory.create({ data: { name: `分類${Date.now()}` } });
  return createActivity({
    title: '活動',
    description: 'd',
    categoryId: category.id,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-02'),
    capacity: 10,
    teacherIds: [teacher.id],
  });
}

beforeEach(async () => {
  await prisma.activityImage.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe('addImage / listImagesWithUrls', () => {
  it('stores a row and lists images oldest-first with signed urls', async () => {
    const activity = await makeActivity();
    await addImage(activity.id, `${activity.id}/1.jpg`);
    await addImage(activity.id, `${activity.id}/2.jpg`);
    const images = await listImagesWithUrls(activity.id);
    expect(images).toHaveLength(2);
    expect(images[0].url).toBe(`https://signed/${activity.id}/1.jpg`);
    expect(new Date(images[0].createdAt) <= new Date(images[1].createdAt)).toBe(true);
  });

  it('returns [] without calling storage for an activity with no images', async () => {
    const activity = await makeActivity();
    expect(await listImagesWithUrls(activity.id)).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('deleteImage', () => {
  it('deletes the row and the storage object', async () => {
    const activity = await makeActivity();
    const img = await addImage(activity.id, `${activity.id}/1.jpg`);
    await deleteImage(img.id);
    expect(await prisma.activityImage.count()).toBe(0);
    expect(deleteActivityImages).toHaveBeenCalledWith([`${activity.id}/1.jpg`]);
  });

  it('still deletes the row when storage deletion fails', async () => {
    vi.mocked(deleteActivityImages).mockRejectedValueOnce(new Error('storage down'));
    const activity = await makeActivity();
    const img = await addImage(activity.id, `${activity.id}/1.jpg`);
    await expect(deleteImage(img.id)).resolves.toBeUndefined();
    expect(await prisma.activityImage.count()).toBe(0);
  });
});

describe('deleteActivity cascade', () => {
  it('deletes image rows and storage objects along with the activity', async () => {
    const activity = await makeActivity();
    await addImage(activity.id, `${activity.id}/1.jpg`);
    await addImage(activity.id, `${activity.id}/2.jpg`);
    await deleteActivity(activity.id);
    expect(await prisma.activityImage.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(0);
    expect(deleteActivityImages).toHaveBeenCalledWith(
      expect.arrayContaining([`${activity.id}/1.jpg`, `${activity.id}/2.jpg`]),
    );
  });
});
```

（`createActivity` 的參數形狀以現檔 `activityService.ts:54` 的
`CreateActivityInput` 為準——實作者請先讀該檔，若欄位名不同以現檔為準修
測試 helper，不改 service。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityImageService.test.ts`
Expected: FAIL（service 不存在）。

- [ ] **Step 3: 實作 `src/lib/services/activityImageService.ts`**

```ts
import { prisma } from '@/lib/db';
import { createSignedUrls, deleteActivityImages } from '@/lib/storage';

export async function listImagesWithUrls(activityId: string) {
  const rows = await prisma.activityImage.findMany({
    where: { activityId },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return [];
  const urls = await createSignedUrls(rows.map((r) => r.storagePath));
  return rows.map((r) => ({ id: r.id, url: urls.get(r.storagePath) ?? '', createdAt: r.createdAt }));
}

export function addImage(activityId: string, storagePath: string) {
  return prisma.activityImage.create({ data: { activityId, storagePath } });
}

export async function deleteImage(imageId: string) {
  const image = await prisma.activityImage.delete({ where: { id: imageId } });
  // Orphaned storage objects are acceptable; a DB row pointing at a deleted
  // object is not — so the DB delete commits first and storage errors are
  // swallowed.
  try {
    await deleteActivityImages([image.storagePath]);
  } catch {}
}
```

- [ ] **Step 4: 擴充 `deleteActivity`（activityService.ts）**

```ts
export async function deleteActivity(id: string) {
  const images = await prisma.activityImage.findMany({ where: { activityId: id }, select: { storagePath: true } });
  await prisma.$transaction([
    prisma.activityImage.deleteMany({ where: { activityId: id } }),
    prisma.activityRegistration.deleteMany({ where: { activityId: id } }),
    prisma.activityTeacher.deleteMany({ where: { activityId: id } }),
    prisma.activity.delete({ where: { id } }),
  ]);
  try {
    await deleteActivityImages(images.map((i) => i.storagePath));
  } catch {}
}
```

檔頂加 `import { deleteActivityImages } from '@/lib/storage';`。

- [ ] **Step 5: 更新 activityService.test.ts**

beforeEach 第一行前插入 `await prisma.activityImage.deleteMany();`。
（該檔其他測試不動；級聯測試已在新測試檔。activityService.test.ts 因
import 鏈會載到 storage.ts——檔頂加同款 `vi.mock('@/lib/storage', …)`
三函式 stub，避免真的初始化 Supabase client。）

- [ ] **Step 6: 全測試綠**

Run: `npm test`
Expected: 全數通過（168 + 新增 6 條）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/activityImageService.ts src/lib/services/activityImageService.test.ts src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: activity image service with signed urls and delete cascade"
```

---

### Task 4: API routes（list / upload / delete）

**Files:**
- Create: `src/app/api/activities/[id]/images/route.ts`
- Create: `src/app/api/activity-images/[id]/route.ts`
- Test: `src/app/api/activities/[id]/images/route.test.ts`

**Interfaces:**
- Consumes: Task 3 的 service 函式、Task 2 的 `uploadActivityImage`。
- Produces:
  - `GET /api/activities/:id/images` → 200 `[{id,url,createdAt}]`；未登入 403；活動不存在 404。
  - `POST /api/activities/:id/images`（multipart，欄位 `file`）→ 201 新紀錄含 url；非 ADMIN 403；活動不存在 404；型別/大小不符 400 `{error:'INVALID_FILE'}`。
  - `DELETE /api/activity-images/:id` → 204；非 ADMIN 403；不存在 404。

- [ ] **Step 1: 寫失敗測試（權限矩陣 + 驗證）**

`src/app/api/activities/[id]/images/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(async (activityId: string) => `${activityId}/mock.jpg`),
  createSignedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { GET, POST } from './route';
import { DELETE } from '../../../activity-images/[id]/route';
import { createTeacher } from '@/lib/services/teacherService';
import { createActivity } from '@/lib/services/activityService';

async function makeActivity() {
  const teacher = await createTeacher({ name: '師', email: `t${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
  const category = await prisma.activityCategory.create({ data: { name: `c${Date.now()}` } });
  return createActivity({
    title: 'a', description: 'd', categoryId: category.id,
    startDate: new Date('2026-08-01'), endDate: new Date('2026-08-02'),
    capacity: 5, teacherIds: [teacher.id],
  });
}

function filePost(id: string, type = 'image/jpeg', bytes = 100) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'p.jpg', { type }));
  return new Request(`http://x/api/activities/${id}/images`, { method: 'POST', body: form });
}

beforeEach(async () => {
  await prisma.activityImage.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/activities/:id/images', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET(new Request('http://x'), { params: { id: 'whatever' } });
    expect(res.status).toBe(403);
  });
  it('404 for a missing activity', async () => {
    asStudent();
    const res = await GET(new Request('http://x'), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });
  it('200 with signed urls for any logged-in role', async () => {
    asStudent();
    const activity = await makeActivity();
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/1.jpg` } });
    const res = await GET(new Request('http://x'), { params: { id: activity.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].url).toContain('https://signed/');
  });
});

describe('POST /api/activities/:id/images', () => {
  it('403 for non-admin', async () => {
    asStudent();
    const activity = await makeActivity();
    expect((await POST(filePost(activity.id), { params: { id: activity.id } })).status).toBe(403);
  });
  it('404 for missing activity', async () => {
    asAdmin();
    expect((await POST(filePost('nope'), { params: { id: 'nope' } })).status).toBe(404);
  });
  it('400 for wrong content type and oversize file', async () => {
    asAdmin();
    const activity = await makeActivity();
    expect((await POST(filePost(activity.id, 'application/pdf'), { params: { id: activity.id } })).status).toBe(400);
    expect((await POST(filePost(activity.id, 'image/jpeg', 4_194_305), { params: { id: activity.id } })).status).toBe(400);
  });
  it('201 stores the image and returns a signed url', async () => {
    asAdmin();
    const activity = await makeActivity();
    const res = await POST(filePost(activity.id), { params: { id: activity.id } });
    expect(res.status).toBe(201);
    expect(await prisma.activityImage.count()).toBe(1);
    expect((await res.json()).url).toContain('https://signed/');
  });
});

describe('DELETE /api/activity-images/:id', () => {
  it('403 for non-admin, 404 for missing, 204 on success', async () => {
    const activity = await makeActivity();
    const img = await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: 'a/1.jpg' } });
    asStudent();
    expect((await DELETE(new Request('http://x'), { params: { id: img.id } })).status).toBe(403);
    asAdmin();
    expect((await DELETE(new Request('http://x'), { params: { id: 'nope' } })).status).toBe(404);
    expect((await DELETE(new Request('http://x'), { params: { id: img.id } })).status).toBe(204);
    expect(await prisma.activityImage.count()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run "src/app/api/activities/[id]/images/route.test.ts"`
Expected: FAIL（route 不存在）。

- [ ] **Step 3: 實作 `src/app/api/activities/[id]/images/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadActivityImage } from '@/lib/storage';
import { listImagesWithUrls, addImage } from '@/lib/services/activityImageService';
import { createSignedUrls } from '@/lib/storage';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4_194_304;

async function activityExists(id: string) {
  return (await prisma.activity.count({ where: { id } })) > 0;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await activityExists(params.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await listImagesWithUrls(params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await activityExists(params.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'INVALID_FILE' }, { status: 400 });
  }
  const storagePath = await uploadActivityImage(params.id, Buffer.from(await file.arrayBuffer()), file.type);
  const row = await addImage(params.id, storagePath);
  const urls = await createSignedUrls([storagePath]);
  return NextResponse.json({ id: row.id, url: urls.get(storagePath) ?? '', createdAt: row.createdAt }, { status: 201 });
}
```

- [ ] **Step 4: 實作 `src/app/api/activity-images/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteImage } from '@/lib/services/activityImageService';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const exists = await prisma.activityImage.count({ where: { id: params.id } });
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteImage(params.id);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: 全測試綠 + lint**

Run: `npm test && npm run lint`
Expected: 全綠、lint 乾淨。

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/activities/[id]/images" "src/app/api/activity-images"
git commit -m "feat: activity image API — list with signed urls, admin upload and delete"
```

---

### Task 5: 前端——壓縮工具 + ActivityAlbum 元件

**Files:**
- Create: `src/lib/imageCompression.ts`
- Create: `src/components/ActivityAlbum.tsx`

**Interfaces:**
- Consumes: Task 4 的三支 API、既有 `Button`/`useToast`、`.skeleton-shimmer`/`.animate-fade-in`。
- Produces: `<ActivityAlbum activityId={string} canManage={boolean} />`（Task 6 接入用）。

- [ ] **Step 1: `src/lib/imageCompression.ts`**

```ts
// Browser-only: downscale to a max edge of 2000px and re-encode as JPEG 0.85
// so phone photos (5-8MB) land around 1MB — under the API's 4MB cap and
// cheap on the storage quota. PNG/WebP are re-encoded too (screenshots
// rarely need alpha in an activity album; consistency beats edge cases).
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('圖片壓縮失敗');
  return blob;
}
```

- [ ] **Step 2: `src/components/ActivityAlbum.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { compressImage } from '@/lib/imageCompression';

interface AlbumImage {
  id: string;
  url: string;
}

export default function ActivityAlbum({ activityId, canManage }: { activityId: string; canManage: boolean }) {
  const { showToast } = useToast();
  const [images, setImages] = useState<AlbumImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/activities/${activityId}/images`);
      setImages(await res.json());
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      let failed = 0;
      for (const file of Array.from(files)) {
        try {
          const blob = await compressImage(file);
          const form = new FormData();
          form.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
          const res = await fetch(`/api/activities/${activityId}/images`, { method: 'POST', body: form });
          if (!res.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      showToast(failed === 0 ? '照片已上傳' : `有 ${failed} 張上傳失敗`);
      setLoading(false);
      await load();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(imageId: string) {
    if (!confirm('確定要刪除這張照片嗎？')) return;
    setPendingId(imageId);
    try {
      const res = await fetch(`/api/activity-images/${imageId}`, { method: 'DELETE' });
      if (res.ok) {
        setImages((prev) => prev.filter((i) => i.id !== imageId));
        showToast('照片已刪除');
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">相簿</h3>
        {canManage && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1 text-xs"
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              ＋ 上傳照片
            </Button>
          </>
        )}
      </div>
      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer aspect-square rounded-lg" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <p className="text-sm text-inkMuted">尚無照片</p>
      ) : (
        <div className="animate-fade-in grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div key={img.id} className="relative">
              <button
                type="button"
                className="block w-full cursor-pointer"
                onClick={() => window.open(img.url, '_blank', 'noopener')}
                aria-label="檢視照片"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; next/image optimization would re-fetch through the server and break on expiry */}
                <img src={img.url} alt="活動照片" className="aspect-square w-full rounded-lg object-cover" />
              </button>
              {canManage && (
                <button
                  type="button"
                  aria-label="刪除照片"
                  disabled={pendingId === img.id}
                  onClick={() => handleDelete(img.id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80 disabled:opacity-50"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: lint + 型別**

Run: `npm run lint && npx tsc --noEmit`
Expected: 乾淨。（元件尚未被引用——下一個 task 接入；不算 dead code，
同一分支內接續。）

- [ ] **Step 4: Commit**

```bash
git add src/lib/imageCompression.ts src/components/ActivityAlbum.tsx
git commit -m "feat: ActivityAlbum component with client-side compression"
```

---

### Task 6: 接入三個角色的活動詳情 Modal

**Files:**
- Modify: `src/app/admin/activities/page.tsx`（活動名單 Modal 內）
- Modify: `src/app/student/activities/page.tsx:154-170`（詳情 Modal 內）
- Modify: `src/app/teacher/activities/page.tsx:63-78`（詳情 Modal 內）

**Interfaces:**
- Consumes: Task 5 的 `<ActivityAlbum>`。

- [ ] **Step 1: 三檔各加 import 與元件**

每檔加 `import ActivityAlbum from '@/components/ActivityAlbum';`。

- `admin/activities/page.tsx`：`<Modal title="活動名單">` 內、`{viewing && (…)}` 區塊的最末（報名名單之後）加：
  ```tsx
  <ActivityAlbum activityId={viewing.id} canManage />
  ```
- `student/activities/page.tsx` 與 `teacher/activities/page.tsx`：同位置加：
  ```tsx
  <ActivityAlbum activityId={viewing.id} canManage={false} />
  ```

（三個 Modal 的 `{viewing && …}` 都是 `flex flex-col gap-3` 容器，直接
當最後一個 child 放入即可。）

- [ ] **Step 2: lint + tsc + 全測試**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: 全部乾淨/綠。

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/activities/page.tsx src/app/student/activities/page.tsx src/app/teacher/activities/page.tsx
git commit -m "feat: show activity album in all three role detail modals"
```

---

### Task 7: 瀏覽器驗證矩陣 + 收尾

**Files:** 無（除非驗證發現問題）

- [ ] **Step 1: dev server 實測（worktree、真 Supabase）**

1. ADMIN：開活動詳情 → 上傳 1 張大圖（>4MB 原檔）→ 壓縮後成功、
   縮圖出現、Storage 後台看得到檔案（或以 API 確認）。
2. 多選 3 張一次上傳；刪除其中 1 張（confirm → 消失 + toast）。
3. STUDENT 與 TEACHER：同活動詳情看得到縮圖、沒有上傳/刪除鈕；
   點縮圖新分頁開圖。
4. 未帶簽名參數直開
   `https://zmqsncnkmxredprzkyfw.supabase.co/storage/v1/object/activity-images/<path>`
   應 400/403（私有 bucket 驗證）。
5. 刪除整個活動 → DB 無殘留 row（`prisma.activityImage.count`）。
6. 深淺色主題各看一次相簿區（shimmer、縮圖、刪除鈕）。

- [ ] **Step 2: 回歸**

Run: `npm test && npm run lint && npm run build`
Expected: 全綠、無新警告。

- [ ] **Step 3: 上線前置（合併後、推送前執行）**

對正式庫推 schema（additive，安全）：

```bash
DATABASE_URL=$(grep "^DATABASE_URL" .env.production.local | cut -d= -f2- | tr -d '"') npx prisma db push
```

Expected: `Your database is now in sync`。**先跑這步再 push 程式碼**，
否則新程式打到還沒有 ActivityImage 表的正式庫會 500。

- [ ] **Step 4: 使用者驗收**

回報完成，請使用者在 Safari 實測上傳與瀏覽後再收尾。
