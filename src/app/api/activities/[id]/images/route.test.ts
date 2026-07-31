import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(async (activityId: string) => `${activityId}/mock.jpg`),
  createSignedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { GET, POST } from './route';
import { DELETE } from '../../../activity-images/[id]/route';
import { createTeacher } from '@/lib/services/teacherService';
import { createActivity } from '@/lib/services/activityService';

async function makeActivity() {
  const teacher = await createTeacher({ name: '師', email: `t${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
  const category = await prisma.activityCategory.create({ data: { name: `c${Date.now()}` } });
  return createActivity({
    title: 'a', description: 'd', categoryId: category.id,
    startDate: new Date('2026-08-01'), endDate: new Date('2026-08-02'),
    capacity: 5, teacherIds: [teacher.id],
  });
}

function filePost(id: string, type = 'image/jpeg', bytes = 100) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'p.jpg', { type }));
  return new Request(`http://x/api/activities/${id}/images`, { method: 'POST', body: form });
}

// Full FK-safe defensive sweep (same convention as makeupRequestService.test.ts):
// Vitest schedules test files in a data-dependent order, so this beforeEach
// must be resilient to another file's leftover Class/LeaveRequest/etc. rows
// still referencing a Teacher/Student this sweep is about to delete.
beforeEach(async () => {
  await prisma.classAttendance.deleteMany();
  await prisma.oneOnOneAttendance.deleteMany();
  await prisma.goHallAttendance.deleteMany();
  await prisma.activityAttendance.deleteMany();
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityImage.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/activities/:id/images', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET(new Request('http://x'), { params: { id: 'whatever' } });
    expect(res.status).toBe(403);
  });
  it('404 for a missing activity', async () => {
    asStudent();
    const res = await GET(new Request('http://x'), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });
  it('200 with signed urls for any logged-in role', async () => {
    asStudent();
    const activity = await makeActivity();
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/1.jpg` } });
    const res = await GET(new Request('http://x'), { params: { id: activity.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].url).toContain('https://signed/');
  });
});

describe('POST /api/activities/:id/images', () => {
  it('403 for non-admin', async () => {
    asStudent();
    const activity = await makeActivity();
    expect((await POST(filePost(activity.id), { params: { id: activity.id } })).status).toBe(403);
  });
  it('404 for missing activity', async () => {
    asAdmin();
    expect((await POST(filePost('nope'), { params: { id: 'nope' } })).status).toBe(404);
  });
  it('400 for wrong content type and oversize file', async () => {
    asAdmin();
    const activity = await makeActivity();
    expect((await POST(filePost(activity.id, 'application/pdf'), { params: { id: activity.id } })).status).toBe(400);
    expect((await POST(filePost(activity.id, 'image/jpeg', 4_194_305), { params: { id: activity.id } })).status).toBe(400);
  });
  it('201 stores the image and returns a signed url', async () => {
    asAdmin();
    const activity = await makeActivity();
    const res = await POST(filePost(activity.id), { params: { id: activity.id } });
    expect(res.status).toBe(201);
    expect(await prisma.activityImage.count()).toBe(1);
    expect((await res.json()).url).toContain('https://signed/');
  });
});

describe('DELETE /api/activity-images/:id', () => {
  it('403 for non-admin, 404 for missing, 204 on success', async () => {
    const activity = await makeActivity();
    const img = await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: 'a/1.jpg' } });
    asStudent();
    expect((await DELETE(new Request('http://x'), { params: { id: img.id } })).status).toBe(403);
    asAdmin();
    expect((await DELETE(new Request('http://x'), { params: { id: 'nope' } })).status).toBe(404);
    expect((await DELETE(new Request('http://x'), { params: { id: img.id } })).status).toBe(204);
    expect(await prisma.activityImage.count()).toBe(0);
  });
});
