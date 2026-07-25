import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadActivityImage, createSignedUrls } from '@/lib/storage';
import { listImagesWithUrls, addImage } from '@/lib/services/activityImageService';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4_194_304;

async function activityExists(id: string) {
  return (await prisma.activity.count({ where: { id } })) > 0;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await activityExists(params.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await listImagesWithUrls(params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!(await activityExists(params.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'INVALID_FILE' }, { status: 400 });
  }

  const storagePath = await uploadActivityImage(params.id, Buffer.from(await file.arrayBuffer()), file.type);
  const row = await addImage(params.id, storagePath);
  const urls = await createSignedUrls([storagePath]);
  return NextResponse.json({ id: row.id, url: urls.get(storagePath) ?? '', createdAt: row.createdAt }, { status: 201 });
}
