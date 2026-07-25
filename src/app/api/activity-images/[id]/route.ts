import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
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
  try {
    await deleteImage(params.id);
  } catch (err) {
    // Two concurrent deletes of the same image: the second request's row is
    // already gone by the time it reaches the DB delete, despite passing the
    // count check above. Treat that race as a 404, not a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
  return new NextResponse(null, { status: 204 });
}
