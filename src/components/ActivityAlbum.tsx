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
      if (res.ok) {
        setImages(await res.json());
      }
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
              {img.url ? (
                <button
                  type="button"
                  className="block w-full cursor-pointer"
                  onClick={() => window.open(img.url, '_blank', 'noopener')}
                  aria-label="檢視照片"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; next/image optimization would re-fetch through the server and break on expiry */}
                  <img src={img.url} alt="活動照片" className="aspect-square w-full rounded-lg object-cover" />
                </button>
              ) : (
                <div className="bg-stripe aspect-square w-full rounded-lg" aria-label="照片無法載入" />
              )}
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
