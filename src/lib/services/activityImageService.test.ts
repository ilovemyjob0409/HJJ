import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';

vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { createSignedUrls, deleteActivityImages } from '@/lib/storage';
import { listImagesWithUrls, addImage, deleteImage } from './activityImageService';
import { createActivity, deleteActivity } from './activityService';

async function makeActivity() {
  const teacher = await createTeacher({ name: '老師', email: `t${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
  const category = await prisma.activityCategory.create({ data: { name: `分類${Date.now()}` } });
  return createActivity({
    title: '活動',
    description: 'd',
    categoryId: category.id,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-02'),
    capacity: 10,
    teacherIds: [teacher.id],
  });
}

beforeEach(async () => {
  await prisma.activityImage.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe('addImage / listImagesWithUrls', () => {
  it('stores a row and lists images oldest-first with signed urls', async () => {
    const activity = await makeActivity();
    await addImage(activity.id, `${activity.id}/1.jpg`);
    await addImage(activity.id, `${activity.id}/2.jpg`);
    const images = await listImagesWithUrls(activity.id);
    expect(images).toHaveLength(2);
    expect(images[0].url).toBe(`https://signed/${activity.id}/1.jpg`);
    expect(new Date(images[0].createdAt) <= new Date(images[1].createdAt)).toBe(true);
  });

  it('returns [] without calling storage for an activity with no images', async () => {
    const activity = await makeActivity();
    expect(await listImagesWithUrls(activity.id)).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('deleteImage', () => {
  it('deletes the row and the storage object', async () => {
    const activity = await makeActivity();
    const img = await addImage(activity.id, `${activity.id}/1.jpg`);
    await deleteImage(img.id);
    expect(await prisma.activityImage.count()).toBe(0);
    expect(deleteActivityImages).toHaveBeenCalledWith([`${activity.id}/1.jpg`]);
  });

  it('still deletes the row when storage deletion fails', async () => {
    vi.mocked(deleteActivityImages).mockRejectedValueOnce(new Error('storage down'));
    const activity = await makeActivity();
    const img = await addImage(activity.id, `${activity.id}/1.jpg`);
    await expect(deleteImage(img.id)).resolves.toBeUndefined();
    expect(await prisma.activityImage.count()).toBe(0);
  });
});

describe('deleteActivity cascade', () => {
  it('deletes image rows and storage objects along with the activity', async () => {
    const activity = await makeActivity();
    await addImage(activity.id, `${activity.id}/1.jpg`);
    await addImage(activity.id, `${activity.id}/2.jpg`);
    await deleteActivity(activity.id);
    expect(await prisma.activityImage.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(0);
    expect(deleteActivityImages).toHaveBeenCalledWith(
      expect.arrayContaining([`${activity.id}/1.jpg`, `${activity.id}/2.jpg`]),
    );
  });
});
