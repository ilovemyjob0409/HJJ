import { prisma } from '@/lib/db';

export async function getBillingSetting() {
  const row = await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main' },
    update: {},
  });
  return { deductionCap: row.deductionCap, paymentInfo: row.paymentInfo };
}

export async function updateBillingSetting(input: { deductionCap?: number; paymentInfo?: string }): Promise<void> {
  if (input.deductionCap !== undefined && input.deductionCap < 0) throw new Error('INVALID_CAP');
  await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main', ...input },
    update: input,
  });
}
