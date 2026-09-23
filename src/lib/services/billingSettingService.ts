import { prisma } from '@/lib/db';

export async function getBillingSetting() {
  const row = await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main' },
    update: {},
  });
  return {
    deductionCap: row.deductionCap,
    paymentInfo: row.paymentInfo,
    goHallTicketPrice: row.goHallTicketPrice,
    goHallSeasonPassPrice: row.goHallSeasonPassPrice,
  };
}

export async function updateBillingSetting(input: {
  deductionCap?: number;
  paymentInfo?: string;
  goHallTicketPrice?: number;
  goHallSeasonPassPrice?: number;
}): Promise<void> {
  if (input.deductionCap !== undefined && input.deductionCap < 0) throw new Error('INVALID_CAP');
  for (const price of [input.goHallTicketPrice, input.goHallSeasonPassPrice]) {
    if (price !== undefined && (!Number.isInteger(price) || price < 0)) throw new Error('INVALID_PRICE');
  }
  await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main', ...input },
    update: input,
  });
}
