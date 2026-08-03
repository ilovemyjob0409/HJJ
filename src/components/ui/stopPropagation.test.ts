import { describe, expect, it } from 'vitest';
import { withStopPropagation } from './stopPropagation';

describe('withStopPropagation', () => {
  it('stops event propagation before running the handler', () => {
    const calls: string[] = [];
    const handler = withStopPropagation(() => calls.push('handler'));

    handler({ stopPropagation: () => calls.push('stopPropagation') });

    expect(calls).toEqual(['stopPropagation', 'handler']);
  });
});
