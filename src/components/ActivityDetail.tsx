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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (images.length > 1 && e.key === 'ArrowRight') {
        const currentIdx = selectedId === null ? -1 : images.findIndex((i) => i.id === selectedId);
        const idx = currentIdx === -1 ? 0 : currentIdx;
        setSelectedId(images[(idx + 1) % images.length].id);
      }
      if (images.length > 1 && e.key === 'ArrowLeft') {
        const currentIdx = selectedId === null ? -1 : images.findIndex((i) => i.id === selectedId);
        const idx = currentIdx === -1 ? 0 : currentIdx;
        setSelectedId(images[(idx - 1 + images.length) % images.length].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, images, selectedId]);

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
        const idx = images.findIndex((i) => i.id === imageId);
        const next = images.filter((i) => i.id !== imageId);
        setImages((prev) => prev.filter((i) => i.id !== imageId));
        // 刪除選取中的照片：原位順移下一張、刪到最後退前一張；刪其他張：選取不動。
        setSelectedId((sel) => {
          if (sel !== imageId) return sel;
          if (next.length === 0) return null;
          return next[Math.min(Math.max(idx, 0), next.length - 1)].id;
        });
        showToast('照片已刪除');
        onImagesChanged?.();
      }
    } finally {
      setPendingImageId(null);
    }
  }

  const selectedIndexRaw = selectedId === null ? -1 : images.findIndex((i) => i.id === selectedId);
  const selectedIndex = selectedIndexRaw === -1 ? 0 : selectedIndexRaw;
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
                    onClick={() => setSelectedId(img.id)}
                    aria-label={`第 ${i + 1} 張照片`}
                    aria-current={i === selectedIndex ? 'true' : undefined}
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
                    aria-label={`刪除第 ${i + 1} 張照片`}
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
          <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="照片檢視" onClick={() => setLightboxOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived */}
            <img src={selected.url} alt="活動照片" className="max-h-[90vh] max-w-[92vw] object-contain" onClick={(e) => e.stopPropagation()} />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="上一張"
                  onClick={(e) => { e.stopPropagation(); setSelectedId(images[(selectedIndex - 1 + images.length) % images.length].id); }}
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="下一張"
                  onClick={(e) => { e.stopPropagation(); setSelectedId(images[(selectedIndex + 1) % images.length].id); }}
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
