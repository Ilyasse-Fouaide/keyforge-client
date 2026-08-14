import { describe, expect, it } from 'vitest';

import { TokenVerificationError } from '../../../src/crypto/errors.js';
import { assertNoClockRollback, ClockRollbackDetectedError } from '../../../src/clock/rollback.js';

describe('assertNoClockRollback', () => {
  it('does not throw when now === lastValidatedAt (no time has passed — not a rollback)', () => {
    expect(() => assertNoClockRollback({ now: 1000, lastValidatedAt: 1000 })).not.toThrow();
  });

  it('does not throw when now > lastValidatedAt (ordinary forward progress)', () => {
    expect(() => assertNoClockRollback({ now: 1001, lastValidatedAt: 1000 })).not.toThrow();
  });

  it('throws ClockRollbackDetectedError when now < lastValidatedAt, carrying both values', () => {
    expect(() => assertNoClockRollback({ now: 999, lastValidatedAt: 1000 })).toThrow(
      ClockRollbackDetectedError,
    );

    try {
      assertNoClockRollback({ now: 999, lastValidatedAt: 1000 });
    } catch (err) {
      expect(err.now).toBe(999);
      expect(err.lastValidatedAt).toBe(1000);
    }
  });

  it('ClockRollbackDetectedError is not an instance of TokenVerificationError', () => {
    try {
      assertNoClockRollback({ now: 999, lastValidatedAt: 1000 });
      throw new Error('expected assertNoClockRollback to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClockRollbackDetectedError);
      expect(err).not.toBeInstanceOf(TokenVerificationError);
    }
  });

  it.each([
    ['now is undefined', { now: undefined, lastValidatedAt: 1000 }],
    ['lastValidatedAt is undefined', { now: 1000, lastValidatedAt: undefined }],
    ['now is NaN', { now: NaN, lastValidatedAt: 1000 }],
    ['lastValidatedAt is a numeric string', { now: 1000, lastValidatedAt: '999' }],
  ])('fails closed with TypeError, not silently "no rollback", when %s', (_name, args) => {
    expect(() => assertNoClockRollback(args)).toThrow(TypeError);
    expect(() => assertNoClockRollback(args)).not.toThrow(ClockRollbackDetectedError);
  });
});
