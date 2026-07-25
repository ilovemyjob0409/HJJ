import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteImage } from '@/lib/services/activityImageService';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const exists = await prisma.activityImage.count({ where: { id: params.id } });
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteImage(params.id);
  return new NextResponse(null, { status: 204 });
}
