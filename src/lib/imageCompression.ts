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
