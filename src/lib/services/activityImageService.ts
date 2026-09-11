import { prisma } from '@/lib/db';
import { createSignedUrls, createSignedThumbUrls, deleteActivityImages } from '@/lib/storage';

export async function listImagesWithUrls(activityId: string) {
  const rows = await prisma.activityImage.findMany({
    where: { activityId },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return [];
  const paths = rows.map((r) => r.storagePath);
  // 原圖給燈箱放大用；縮圖給相簿格與主圖，載入量砍 8 成
  const [urls, thumbs] = await Promise.all([createSignedUrls(paths), createSignedThumbUrls(paths).catch(() => new Map<string, string>())]);
  return rows.map((r) => ({
    id: r.id,
    url: urls.get(r.storagePath) ?? '',
    thumbUrl: thumbs.get(r.storagePath) ?? urls.get(r.storagePath) ?? '',
    createdAt: r.createdAt,
  }));
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
