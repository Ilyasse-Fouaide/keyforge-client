// Phase 2 — ported from Keyforge server's tests/helpers/offlineClock.js
// (assertNoClockRollback), unchanged. That file lives under the server
// repo's tests/helpers/ because it has no in-repo caller there — it's a
// tested reference implementation for the client SDK that didn't exist yet.
// This module is that client, so the check becomes real production code.

/**
 * Deliberately extends bare Error, not TokenVerificationError: this check
 * runs before verifyEntitlementToken is ever called, and rejects for a
 * reason crypto/ has no visibility into (local trust state, not the
 * token's own signature/schema/expiry).
 */
export class ClockRollbackDetectedError extends Error {
  constructor(now, lastValidatedAt) {
    super(`System clock (${now}) is behind the last recorded validation time (${lastValidatedAt})`);
    this.name = this.constructor.name;
    this.now = now;
    this.lastValidatedAt = lastValidatedAt;
  }
}

/**
 * Requires both values to already be finite numbers and throws a plain
 * TypeError otherwise, rather than letting `<` silently coerce (e.g.
 * `now < undefined` is false, so a caller whose storage read for the
 * watermark came back empty would otherwise see "no rollback detected"
 * and fall through to trusting the cached token — exactly backwards for a
 * check whose whole point is to fail closed on an ambiguous clock state).
 * A TypeError, not ClockRollbackDetectedError, since this is a contract
 * violation by the caller, not a rollback detection.
 */
export function assertNoClockRollback({ now, lastValidatedAt }) {
  if (!Number.isFinite(now) || !Number.isFinite(lastValidatedAt)) {
    throw new TypeError('assertNoClockRollback requires now and lastValidatedAt as finite numbers');
  }

  if (now < lastValidatedAt) {
    throw new ClockRollbackDetectedError(now, lastValidatedAt);
  }
}
