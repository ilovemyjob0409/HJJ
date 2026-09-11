import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadPrizeImage } from '@/lib/storage';
import { setPrizeImage } from '@/lib/services/prizeService';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4_194_304;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'INVALID_FILE' }, { status: 400 });
  }
  try {
    const storagePath = await uploadPrizeImage(params.id, Buffer.from(await file.arrayBuffer()), file.type);
    await setPrizeImage(params.id, storagePath);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
