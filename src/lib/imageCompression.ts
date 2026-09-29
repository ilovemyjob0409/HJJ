// Browser-only: downscale to the preset's max edge and re-encode as JPEG so
// phone photos (5-8MB) land in the low hundreds of KB — under the API's 4MB
// cap and cheap to download. PNG/WebP are re-encoded too: Safari's canvas
// can't encode WebP (it silently falls back to a much larger PNG), and viewers
// get WebP anyway because Supabase's image transform negotiates it.
export const IMAGE_PRESETS = {
  // 活動照片：燈箱放大會看原圖，1600px 在桌機全螢幕仍清楚
  activity: { maxEdge: 1600, quality: 0.82 },
  // 獎品圖：最大只顯示到約 400px 寬（retina 800px），原圖從不直接給使用者看
  prize: { maxEdge: 1000, quality: 0.82 },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale), resized: scale < 1 };
}

// 已經夠小的 JPEG 重壓一次可能反而變大——沒縮尺寸又沒變小就沿用原檔
export function pickSmallerJpeg(original: Blob, compressed: Blob, resized: boolean): Blob {
  if (!resized && original.type === 'image/jpeg' && original.size <= compressed.size) return original;
  return compressed;
}

export async function compressImage(file: Blob, preset: ImagePreset): Promise<Blob> {
  const { maxEdge, quality } = IMAGE_PRESETS[preset];
  const bitmap = await createImageBitmap(file);
  const { width, height, resized } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('圖片壓縮失敗');
  return pickSmallerJpeg(file, blob, resized);
}
