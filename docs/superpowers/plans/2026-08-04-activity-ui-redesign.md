# 活動封面放大＋詳情彈窗改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 活動列表封面改 128×80 橫式；三端活動詳情彈窗改為版本甲（相簿主圖貼頂＋縮圖列＋燈箱＋圖示資訊列＋名單籤片）。

**Architecture:** `Modal` 加 `flush` 模式（無內建標題列與內距）；新共用元件 `ActivityDetail` 吸收 `ActivityAlbum` 全部邏輯（自行 fetch 相簿、選圖、燈箱、上傳／刪除）並渲染整個彈窗內容；三端頁面改傳資料與動作 slot，最後刪除 `ActivityAlbum.tsx`。無 API／schema 變更。

**Tech Stack:** Next.js App Router client components、Tailwind、既有 `Modal`／`Button`／`ImageCropModal`／`uploadActivityImageFile`。

**Spec:** `docs/superpowers/specs/2026-08-04-activity-cover-size-and-album-redesign.md`

## Global Constraints

- UI 文案一律繁體中文；commit message 用中文、結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 不新增任何 npm 依賴（icon 用內建 inline SVG）、不新增 API endpoint、不改 Prisma schema。
- 動效只用既有 `animate-fade-in`／`animate-modal-in`／`skeleton-shimmer`，不另創動畫。
- 專案慣例不寫 UI 元件測試；驗證＝`npx tsc --noEmit` 乾淨＋既有全套測試維持全綠。
- **不要在本機跑 `npm run build`**（別的 session 的 dev server 在此資料夾運行）；Vercel push 後自行 build。
- 三端詳情彈窗統一 `maxWidthClassName="max-w-xl"`。

---

### Task 1: Modal `flush` 模式＋列表封面 128×80

**Files:**
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/app/student/activities/page.tsx:138,140,157,159`（封面 img 與佔位）
- Modify: `src/app/admin/activities/page.tsx`（封面欄，約 239 行的 img 與其下佔位 div）
- Modify: `src/app/teacher/activities/page.tsx:49,51`

**Interfaces:**
- Consumes: 無（獨立改動）。
- Produces: `Modal` 新 props——`title` 改為可選、新增 `flush?: boolean`。`flush` 為 true 時不渲染內建標題列、容器不加 `p-5`（捲動、backdrop 關閉、動畫不變）。Task 3 依賴此介面。

- [ ] **Step 1: Modal 加 flush**

`src/components/ui/Modal.tsx` 全檔改為：

```tsx
'use client';

import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidthClassName?: string;
  // flush：內容自理內距與標題列（活動詳情等滿版版面用）。
  flush?: boolean;
}

export default function Modal({ open, onClose, title, children, maxWidthClassName = 'max-w-md', flush = false }: ModalProps) {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`animate-modal-in max-h-[90vh] w-full ${maxWidthClassName} overflow-y-auto rounded-xl bg-card ${flush ? '' : 'p-5'} shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        {!flush && (
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
            <button onClick={onClose} className="shrink-0 text-inkMuted hover:text-ink" aria-label="關閉">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: 封面尺寸四處改 128×80**

四個檔案的封面欄，把 `h-10 w-10` 改成 `h-20 w-32`（img 與 `bg-stripe` 佔位 div 都要改，其餘 class 不動）。改完後的樣子（以學生頁活動列表為例，其餘三處相同 pattern）：

```tsx
a.coverUrl ? (
  // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
  <img src={a.coverUrl} alt="封面" className="mx-auto h-20 w-32 rounded object-cover" />
) : (
  <div className="bg-stripe mx-auto h-20 w-32 rounded" />
)
```

四處：學生頁活動列表（~138、140）、學生頁我的報名紀錄（~157、159）、行政頁（~239 與佔位）、老師頁（49、51）。

- [ ] **Step 3: 驗證**

Run: `npx tsc --noEmit` → 無錯誤。
Run: `grep -rn "h-10 w-10" src/app/student/activities src/app/admin/activities src/app/teacher/activities` → 無輸出（封面已全改）。

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Modal.tsx src/app/student/activities/page.tsx src/app/admin/activities/page.tsx src/app/teacher/activities/page.tsx
git commit -m "feat: 活動列表封面改 128×80 橫式＋Modal 支援 flush 滿版模式

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 新共用元件 `ActivityDetail`

**Files:**
- Create: `src/components/ActivityDetail.tsx`

**Interfaces:**
- Consumes: Task 1 的 `Modal flush`（本任務不直接用，但版面按 flush 前提設計：容器無外距，內距自理）；
  既有 `ImageCropModal`（props `files`/`onDone`）、`uploadActivityImageFile(activityId, blob)`、
  `useToast`、`formatActivityDateRange(start, end, 'zh-TW')`、`Button`。
- Produces（Task 3 依賴，名稱型別須完全一致）：

  ```ts
  export interface ActivityDetailData {
    id: string;
    title: string;
    description: string;
    category: { name: string };
    location: string | null;
    startDate: string;
    endDate: string;
    capacity: number;
    teachers: { teacher: { user: { name: string } } }[];
    registrations: { id: string; student: { user: { name: string } } }[];
  }
  interface ActivityDetailProps {
    activity: ActivityDetailData;
    onClose: () => void;
    canManageAlbum?: boolean;        // default false
    onImagesChanged?: () => void;
    rosterItemAction?: (r: ActivityDetailData['registrations'][number]) => ReactNode;
    footer?: ReactNode;              // 各端動作區；無則不渲染 footer 分隔線
  }
  export default function ActivityDetail(props: ActivityDetailProps): JSX.Element
  ```

- [ ] **Step 1: 建立 `src/components/ActivityDetail.tsx`**

完整內容：

```tsx
'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/ui/Button';
import ImageCropModal from '@/components/ImageCropModal';
import { useToast } from '@/components/ui/Toast';
import { uploadActivityImageFile } from '@/lib/uploadActivityImage';
import { formatActivityDateRange } from '@/lib/activityDateRange';

interface AlbumImage {
  id: string;
  url: string;
}

export interface ActivityDetailData {
  id: string;
  title: string;
  description: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
  registrations: { id: string; student: { user: { name: string } } }[];
}

interface ActivityDetailProps {
  activity: ActivityDetailData;
  onClose: () => void;
  canManageAlbum?: boolean;
  onImagesChanged?: () => void;
  rosterItemAction?: (r: ActivityDetailData['registrations'][number]) => ReactNode;
  footer?: ReactNode;
}

// 不新增 icon 依賴：比照 admin/students 的 LowQuotaIcon，內建 16px stroke SVG。
function CalendarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M4 11h16" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-6-5.1-6-10a6 6 0 1 1 12 0c0 4.9-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.5-3.2 4-4.8 7-4.8s5.5 1.6 7 4.8" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c1.3-2.8 3.5-4.2 6-4.2s4.7 1.4 6 4.2" />
      <path d="M15.5 5.3a3 3 0 0 1 0 5.4M17.5 15.9c1.6.7 2.9 2 3.5 4.1" />
    </svg>
  );
}

export default function ActivityDetail({
  activity,
  onClose,
  canManageAlbum = false,
  onImagesChanged,
  rosterItemAction,
  footer,
}: ActivityDetailProps) {
  const { showToast } = useToast();
  const [images, setImages] = useState<AlbumImage[]>([]);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingImageId, setPendingImageId] = useState<string | null>(null);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/activities/${activity.id}/images`);
      if (res.ok) {
        setImages(await res.json());
      }
    } finally {
      setAlbumLoading(false);
    }
  }, [activity.id]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // 陣列縮短（刪除、重載）時把選取索引收斂回合法範圍；
  // 刪除選取中的照片＝原索引順移下一張、刪到最後退前一張。
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(images.length - 1, 0)));
  }, [images.length]);

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowRight') setSelectedIndex((i) => (i + 1) % images.length);
      if (e.key === 'ArrowLeft') setSelectedIndex((i) => (i - 1 + images.length) % images.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, images.length]);

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
        const ok = await uploadActivityImageFile(activity.id, blob);
        if (!ok) failed += 1;
      }
      showToast(failed === 0 ? '照片已上傳' : `有 ${failed} 張上傳失敗`);
      await loadImages();
      onImagesChanged?.();
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!confirm('確定要刪除這張照片嗎？')) return;
    setPendingImageId(imageId);
    try {
      const res = await fetch(`/api/activity-images/${imageId}`, { method: 'DELETE' });
      if (res.ok) {
        // functional update：即使兩張照片的刪除請求交錯完成，也不會用到過期陣列
        setImages((prev) => prev.filter((i) => i.id !== imageId));
        showToast('照片已刪除');
        onImagesChanged?.();
      }
    } finally {
      setPendingImageId(null);
    }
  }

  const selected = images[selectedIndex];
  const hasPhotos = !albumLoading && images.length > 0;

  return (
    <div className="flex flex-col">
      {albumLoading && (
        <div className="flex flex-col gap-2 p-5 pb-0" aria-hidden>
          <div className="skeleton-shimmer aspect-[16/10] w-full rounded-lg" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-14 w-14 rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {hasPhotos && (
        <>
          <div className="relative">
            {selected?.url ? (
              <button type="button" className="block w-full cursor-zoom-in" onClick={() => setLightboxOpen(true)} aria-label="放大檢視照片">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived */}
                <img src={selected.url} alt="活動照片" className="aspect-[16/10] w-full object-cover" />
              </button>
            ) : (
              <div className="bg-stripe aspect-[16/10] w-full" aria-label="照片無法載入" />
            )}
            {images.length > 1 && (
              <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-xs text-white">
                {selectedIndex + 1} / {images.length}
              </span>
            )}
            <button
              type="button"
              aria-label="關閉"
              onClick={onClose}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/70"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-5 pt-2">
            {images.map((img, i) => (
              <div key={img.id} className="relative shrink-0">
                {img.url ? (
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(i)}
                    aria-label={`第 ${i + 1} 張照片`}
                    className={`block h-14 w-14 overflow-hidden rounded-lg ${i === selectedIndex ? 'outline outline-2 outline-brandDark' : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived */}
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className={`bg-stripe h-14 w-14 rounded-lg ${i === selectedIndex ? 'outline outline-2 outline-brandDark' : ''}`} />
                )}
                {canManageAlbum && (
                  <button
                    type="button"
                    aria-label="刪除照片"
                    disabled={pendingImageId === img.id}
                    onClick={() => handleDeleteImage(img.id)}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white hover:bg-black/80 disabled:opacity-50"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {canManageAlbum && (
              <button
                type="button"
                aria-label="上傳照片"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-borderStrong text-lg text-inkMuted hover:text-ink disabled:opacity-50"
              >
                ＋
              </button>
            )}
          </div>
        </>
      )}

      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-ink">{activity.title}</h2>
            <span className="rounded-full border border-borderSubtle bg-stripe px-2.5 py-0.5 text-xs text-ink">{activity.category.name}</span>
          </div>
          {!hasPhotos && (
            <button onClick={onClose} className="shrink-0 text-inkMuted hover:text-ink" aria-label="關閉">
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5 text-sm text-ink">
          <div className="flex items-center gap-2">
            <span className="text-inkMuted"><CalendarIcon /></span>
            {formatActivityDateRange(activity.startDate, activity.endDate, 'zh-TW')}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-inkMuted"><PinIcon /></span>
            {activity.location ?? '地點未定'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-inkMuted"><UserIcon /></span>
            {activity.teachers.map((t) => t.teacher.user.name).join('、')}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-inkMuted"><UsersIcon /></span>
            <span>已報名 {activity.registrations.length}／名額 {activity.capacity}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-stripe">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min((activity.registrations.length / Math.max(activity.capacity, 1)) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {activity.description && <p className="whitespace-pre-wrap text-sm text-ink">{activity.description}</p>}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-inkMuted">報名名單（{activity.registrations.length}）</h3>
          {activity.registrations.length === 0 ? (
            <p className="text-sm text-inkMuted">尚無學生報名</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activity.registrations.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 rounded-full border border-borderSubtle bg-stripe px-2.5 py-1 text-xs text-ink">
                  {r.student.user.name}
                  {rosterItemAction?.(r)}
                </span>
              ))}
            </div>
          )}
        </div>

        {!albumLoading && images.length === 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-inkMuted">相簿</h3>
            {canManageAlbum ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full border-dashed border-borderStrong text-inkMuted hover:text-ink"
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                ＋ 上傳照片
              </Button>
            ) : (
              <p className="text-sm text-inkMuted">尚無照片</p>
            )}
          </div>
        )}

        {footer && <div className="border-t border-borderSubtle pt-4">{footer}</div>}
      </div>

      {canManageAlbum && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      )}
      <ImageCropModal files={cropQueue} onDone={handleCroppedPhotos} />

      {lightboxOpen && selected?.url && typeof document !== 'undefined' &&
        createPortal(
          <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightboxOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived */}
            <img src={selected.url} alt="活動照片" className="max-h-[90vh] max-w-[92vw] object-contain" onClick={(e) => e.stopPropagation()} />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="上一張"
                  onClick={(e) => { e.stopPropagation(); setSelectedIndex((i) => (i - 1 + images.length) % images.length); }}
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="下一張"
                  onClick={(e) => { e.stopPropagation(); setSelectedIndex((i) => (i + 1) % images.length); }}
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75"
                >
                  ›
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="關閉"
              onClick={() => setLightboxOpen(false)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75"
            >
              ✕
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
```

- [ ] **Step 2: 驗證**

Run: `npx tsc --noEmit` → 無錯誤（元件尚未被引用，僅型別把關）。

- [ ] **Step 3: Commit**

```bash
git add src/components/ActivityDetail.tsx
git commit -m "feat: 活動詳情共用元件 ActivityDetail（主圖縮圖列＋燈箱＋圖示資訊列＋名單籤片）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 三端接線＋刪除 `ActivityAlbum`

**Files:**
- Modify: `src/app/student/activities/page.tsx`
- Modify: `src/app/admin/activities/page.tsx`
- Modify: `src/app/teacher/activities/page.tsx`
- Delete: `src/components/ActivityAlbum.tsx`

**Interfaces:**
- Consumes: Task 1 `Modal flush`、Task 2 `ActivityDetail`／`ActivityDetailData`。
- Produces: 無（終端接線）。

- [ ] **Step 1: 學生端**

`src/app/student/activities/page.tsx`：import 把 `ActivityAlbum` 換成 `ActivityDetail`（`import ActivityDetail from '@/components/ActivityDetail';`——注意本檔已有同名 `interface ActivityDetail`，把該 interface 改名為 `ActivityDetailPayload`，兩個使用處同步改：`interface ViewingDetail extends ActivityDetailPayload` 與 `openDetail` 內的 `const data: ActivityDetailPayload = await res.json();`）。詳情 Modal 區塊（原 195-267 行）整段換成：

```tsx
<Modal open={viewing !== null || detailLoading} onClose={closeDetail} flush maxWidthClassName="max-w-xl">
  {viewing ? (
    <ActivityDetail
      activity={viewing}
      onClose={closeDetail}
      footer={
        <div className="flex justify-end">
          {viewing.registrationId ? (
            isBeforeToday(viewing.endDate) ? (
              <span className="text-sm text-inkMuted">活動已結束</span>
            ) : (
              <Button
                variant="secondary"
                className="border-rejected text-rejected hover:bg-rejectedBg"
                onClick={() => handleCancel(viewing.registrationId as string)}
                loading={pendingId === viewing.registrationId}
              >
                取消報名
              </Button>
            )
          ) : (
            <Button
              disabled={viewing._count.registrations >= viewing.capacity}
              onClick={() => handleRegister(viewing.id)}
              loading={pendingId === viewing.id}
            >
              {viewing._count.registrations >= viewing.capacity ? '已額滿' : '報名'}
            </Button>
          )}
        </div>
      }
    />
  ) : (
    <div className="flex flex-col gap-3 p-5" aria-hidden>
      <div className="skeleton-shimmer h-4 w-3/4 rounded" />
      <div className="skeleton-shimmer h-4 w-1/2 rounded" />
      <div className="skeleton-shimmer h-20 w-full rounded" />
      <div className="skeleton-shimmer h-24 w-full rounded" />
    </div>
  )}
</Modal>
```

- [ ] **Step 2: 行政端**

`src/app/admin/activities/page.tsx`：import 把 `ActivityAlbum` 換成 `ActivityDetail`。詳情 Modal（原 425-452 行）整段換成：

```tsx
<Modal open={viewing !== null} onClose={() => setViewing(null)} flush maxWidthClassName="max-w-xl">
  {viewing && (
    <ActivityDetail
      activity={viewing}
      onClose={() => setViewing(null)}
      canManageAlbum
      onImagesChanged={load}
      rosterItemAction={(r) => (
        <button type="button" aria-label="移除報名" className="text-rejected hover:underline" onClick={() => handleRemoveRegistration(r.id)}>
          ✕
        </button>
      )}
      footer={
        <button type="button" className="text-left text-sm text-rejected hover:underline" onClick={handleDeleteActivity}>
          刪除此活動
        </button>
      }
    />
  )}
</Modal>
```

- [ ] **Step 3: 老師端**

`src/app/teacher/activities/page.tsx`：import 把 `ActivityAlbum` 換成 `ActivityDetail`。詳情 Modal（原 75-96 行）整段換成：

```tsx
<Modal open={viewing !== null} onClose={() => setViewing(null)} flush maxWidthClassName="max-w-xl">
  {viewing && <ActivityDetail activity={viewing} onClose={() => setViewing(null)} />}
</Modal>
```

- [ ] **Step 4: 刪除舊元件**

```bash
git rm src/components/ActivityAlbum.tsx
grep -rn "ActivityAlbum" src || echo "OK 無殘留引用"
```

Expected: `OK 無殘留引用`。

- [ ] **Step 5: 驗證**

Run: `npx tsc --noEmit` → 無錯誤。
Run: `npx vitest run src/lib/services/activityService.test.ts` → PASS（UI 改版不應動到 service）。

- [ ] **Step 6: Commit**

```bash
git add -A src/app/student/activities src/app/admin/activities src/app/teacher/activities src/components
git commit -m "feat: 三端活動詳情彈窗改版（版本甲）並移除 ActivityAlbum

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 整體驗證＋部署

**Files:** 無新檔；驗證與 push。

**Interfaces:**
- Consumes: Task 1–3 全部產出。
- Produces: 部署到 Vercel 正式站（無 schema 變更，**不需** production SQL）。

- [ ] **Step 1: 全套測試**

Run: `npm test` → 全部 PASS。

- [ ] **Step 2: Push 部署**

合併回 main 後 `git push origin main`，以 `npx vercel ls` 確認最新 Production deployment Ready。
