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
