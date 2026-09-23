import { describe, it, expect } from 'vitest';
import { getBillingSetting, updateBillingSetting } from './billingSettingService';

describe('billingSettingService', () => {
  it('returns defaults on first read and persists updates', async () => {
    const initial = await getBillingSetting();
    expect(initial).toMatchObject({ deductionCap: 2, paymentInfo: '' });

    await updateBillingSetting({ deductionCap: 3, paymentInfo: '銀行帳戶 123' });
    expect(await getBillingSetting()).toMatchObject({ deductionCap: 3, paymentInfo: '銀行帳戶 123' });
  });

  it('rejects a negative cap', async () => {
    await expect(updateBillingSetting({ deductionCap: -1 })).rejects.toThrow('INVALID_CAP');
  });

  it('弈廳預設價格：預設 0，可更新，負數或非整數擋下', async () => {
    const initial = await getBillingSetting();
    expect(initial.goHallTicketPrice).toBe(0);
    expect(initial.goHallSeasonPassPrice).toBe(0);
    await updateBillingSetting({ goHallTicketPrice: 300, goHallSeasonPassPrice: 4500 });
    expect(await getBillingSetting()).toMatchObject({ goHallTicketPrice: 300, goHallSeasonPassPrice: 4500 });
    await expect(updateBillingSetting({ goHallTicketPrice: -1 })).rejects.toThrow('INVALID_PRICE');
    await expect(updateBillingSetting({ goHallSeasonPassPrice: 1.5 })).rejects.toThrow('INVALID_PRICE');
  });
});
