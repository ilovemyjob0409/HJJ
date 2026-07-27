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
