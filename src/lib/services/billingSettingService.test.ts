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
});
