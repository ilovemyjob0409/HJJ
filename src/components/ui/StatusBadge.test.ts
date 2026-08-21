import { describe, it, expect } from 'vitest';
import { getStatusBadgeConfig } from './StatusBadge';

describe('getStatusBadgeConfig', () => {
  it('maps APPROVED to 已核准', () => {
    expect(getStatusBadgeConfig('APPROVED').label).toBe('已核准');
  });
  it('maps PENDING_ADMIN to 待確認', () => {
    expect(getStatusBadgeConfig('PENDING_ADMIN').label).toBe('待確認');
  });
  it('maps PENDING_ASSIGNMENT to 待確認', () => {
    expect(getStatusBadgeConfig('PENDING_ASSIGNMENT').label).toBe('待確認');
  });
  it('maps REJECTED to 已拒絕', () => {
    expect(getStatusBadgeConfig('REJECTED').label).toBe('已拒絕');
  });
  it('maps ASSIGNED to 已指派', () => {
    expect(getStatusBadgeConfig('ASSIGNED').label).toBe('已指派');
  });
  it('maps NO_SHOW to 未到課', () => {
    expect(getStatusBadgeConfig('NO_SHOW').label).toBe('未到課');
  });
  it('falls back to the raw value for an unknown status', () => {
    expect(getStatusBadgeConfig('WEIRD').label).toBe('WEIRD');
  });
});
