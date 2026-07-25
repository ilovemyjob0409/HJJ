import { compressImage } from '@/lib/imageCompression';

export async function uploadCompressedImage(activityId: string, blob: Blob): Promise<boolean> {
  try {
    const form = new FormData();
    form.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    const res = await fetch(`/api/activities/${activityId}/images`, { method: 'POST', body: form });
    return res.ok;
  } catch {
    return false;
  }
}

export async function uploadActivityImageFile(activityId: string, file: File): Promise<boolean> {
  try {
    const blob = await compressImage(file);
    return await uploadCompressedImage(activityId, blob);
  } catch {
    return false;
  }
}
