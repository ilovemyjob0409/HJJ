import { prisma } from '@/lib/db';
import { createSignedUrls, deleteActivityImages } from '@/lib/storage';

export async function listImagesWithUrls(activityId: string) {
  const rows = await prisma.activityImage.findMany({
    where: { activityId },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return [];
  const urls = await createSignedUrls(rows.map((r) => r.storagePath));
  return rows.map((r) => ({ id: r.id, url: urls.get(r.storagePath) ?? '', createdAt: r.createdAt }));
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
