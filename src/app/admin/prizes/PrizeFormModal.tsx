'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import AlertModal from '@/components/ui/AlertModal';
import { useToast } from '@/components/ui/Toast';
import { compressImage } from '@/lib/imageCompression';

export interface PrizeRow {
  id: string;
  name: string;
  points: number;
  stock: number;
  active: boolean;
  sortOrder: number;
  imageUrl: string | null;
}

interface ErrorInfo {
  title: string;
  message: string;
}

// 新增／編輯共用的欄位驗證錯誤 → 中文；不得把原始錯誤碼／Prisma 錯誤顯示給使用者。
const ERROR_LABELS: Record<string, string> = {
  INVALID_NAME: '請輸入獎品名稱',
  INVALID_POINTS: '點數需為正整數',
  INVALID_STOCK: '庫存不可為負數',
  INVALID_FILE: '圖片格式或大小不符（jpg/png/webp，4MB 內）',
};

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? '發生錯誤，請稍後再試';
}

interface PrizeFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  // 編輯模式下的原始資料；新增模式固定傳 null
  prize: PrizeRow | null;
  onClose: () => void;
  // 主要欄位（新增／狀態／點數等）儲存成功：呼叫端關閉彈窗＋重抓清單
  onSaved: () => void;
  // 圖片上傳成功：只重抓清單，不關閉彈窗（讓使用者留在編輯彈窗裡確認結果）
  onImageUploaded: () => void;
}

// 新增獎品：名稱／點數／庫存／排序＋圖片（先選好，儲存時建完獎品接著上傳）。
// 編輯獎品：再加狀態（上架/下架），圖片選了就即時上傳
// （皆先 compressImage 壓縮再用 FormData POST，比照學生端 PrizeZone 的錯誤呈現風格）。
export default function PrizeFormModal({ open, mode, prize, onClose, onSaved, onImageUploaded }: PrizeFormModalProps) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [points, setPoints] = useState('');
  const [stock, setStock] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState<'true' | 'false'>('true');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  // 新增模式：選好的圖先留在本地，等獎品建立拿到 id 才上傳
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(prize?.name ?? '');
    setPoints(prize ? String(prize.points) : '');
    setStock(prize ? String(prize.stock) : '');
    setSortOrder(prize ? String(prize.sortOrder) : '0');
    setActive(prize?.active === false ? 'false' : 'true');
    setLocalPreviewUrl(null);
    setPendingImage(null);
    setErrorInfo(null);
  }, [open, prize]);

  // 本地預覽的 blob URL 只在這個彈窗活著時有用，換獎品／關閉就釋放掉。
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function uploadImageTo(prizeId: string, blob: Blob): Promise<{ ok: boolean; error?: string }> {
    const formData = new FormData();
    formData.append('file', blob, 'prize.jpg');
    const res = await fetch(`/api/prizes/${prizeId}/image`, { method: 'POST', body: formData });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: (data as { error?: string }).error };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name,
        points: Number(points),
        stock: Number(stock),
        sortOrder: Number(sortOrder),
      };
      if (mode === 'edit') body.active = active === 'true';
      const url = mode === 'create' ? '/api/prizes' : `/api/prizes/${prize!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorInfo({ title: mode === 'create' ? '新增失敗' : '更新失敗', message: errorLabel(data.error) });
        return;
      }
      // 新增模式有先選圖：拿到新獎品 id 後接著上傳。失敗不擋建立——提示改用編輯重傳。
      if (mode === 'create' && pendingImage) {
        const uploaded = await uploadImageTo((data as { id: string }).id, pendingImage).catch(() => ({ ok: false }));
        if (!uploaded.ok) {
          setErrorInfo({ title: '圖片上傳失敗', message: '獎品已建立，但圖片沒傳成功——請從清單「編輯」重新上傳。' });
          onSaved();
          return;
        }
      }
      showToast(mode === 'create' ? '已新增獎品' : '已更新獎品');
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setUploadingImage(true);
    try {
      const compressed = await compressImage(file);
      if (mode === 'create') {
        // 還沒有獎品 id：先留檔＋本地預覽，儲存時才上傳
        setPendingImage(compressed);
        setLocalPreviewUrl(URL.createObjectURL(compressed));
        return;
      }
      if (!prize) return;
      const result = await uploadImageTo(prize.id, compressed);
      if (!result.ok) {
        setErrorInfo({ title: '圖片上傳失敗', message: errorLabel(result.error ?? '') });
        return;
      }
      setLocalPreviewUrl(URL.createObjectURL(compressed));
      showToast('已更新圖片');
      onImageUploaded();
    } catch {
      setErrorInfo({ title: '圖片上傳失敗', message: '圖片處理失敗，請換一張圖片再試' });
    } finally {
      setUploadingImage(false);
    }
  }

  const previewUrl = localPreviewUrl ?? prize?.imageUrl ?? null;

  return (
    <>
      <Modal open={open} onClose={onClose} title={mode === 'create' ? '新增獎品' : '編輯獎品'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            名稱
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink">
              點數
              <Input type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              庫存
              <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} required />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-ink">
            排序
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} required />
          </label>

          {mode === 'edit' && (
            <label className="flex flex-col gap-1 text-sm text-ink">
              狀態
              <Select value={active} onChange={(e) => setActive(e.target.value as 'true' | 'false')}>
                <option value="true">上架</option>
                <option value="false">下架</option>
              </Select>
            </label>
          )}

          <div className="flex flex-col gap-2 border-t border-borderSubtle pt-3">
            <p className="text-sm font-medium text-ink">圖片</p>
            <div className="flex items-center gap-3">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL / local blob preview, short-lived
                <img src={previewUrl} alt={name || '獎品圖片'} className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-stripe text-xl" aria-hidden="true">
                  🎁
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
              />
              <Button type="button" variant="secondary" loading={uploadingImage} onClick={() => fileInputRef.current?.click()}>
                {mode === 'create' ? '選擇圖片' : '上傳圖片'}
              </Button>
            </div>
            <p className="text-xs text-inkMuted">
              jpg／png／webp，4MB 內，自動壓縮{mode === 'create' ? '；儲存時一併上傳' : ''}
            </p>
          </div>

          <Button type="submit" loading={submitting} className="mt-2">
            儲存
          </Button>
        </form>
      </Modal>

      <AlertModal open={errorInfo !== null} onClose={() => setErrorInfo(null)} title={errorInfo?.title ?? '發生錯誤'}>
        {errorInfo?.message}
      </AlertModal>
    </>
  );
}
