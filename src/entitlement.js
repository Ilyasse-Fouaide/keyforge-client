// Phase 2 — getEntitlement(): local verification composition.
//
// Composes clock-rollback detection with signature verification, in that
// order — ported from Keyforge server's tests/offline-flow/clientVerification.test.js
// verifyStoredToken helper: the clock check is a bare, unguarded statement
// that runs to completion (or throws) before verifyEntitlementToken is ever
// called. Translated here from that file's exception-based contract into
// this module's own status-object vocabulary (ARCHITECTURE.md §4/§9).

import { assertNoClockRollback, ClockRollbackDetectedError } from './clock/rollback.js';
import { TokenExpiredError, TokenInvalidError, UnknownKeyVersionError } from './crypto/errors.js';
import { loadPublicKeys } from './crypto/keys.js';
import { verifyEntitlementToken } from './crypto/verify.js';

const defaultGetNow = () => Math.floor(Date.now() / 1000);

/**
 * @param {object} options
 * @param {import('./storage/adapter.js').StorageAdapter} options.storage
 * @param {Record<string, string>} options.publicKeys - keyVersion -> PEM string
 * @param {() => number} [options.getNow] - injectable clock seam for tests; defaults to real time (unix seconds)
 * @returns {Promise<{ getEntitlement: () => Promise<object> }>}
 */
export async function createEntitlementChecker({ storage, publicKeys, getNow = defaultGetNow }) {
  const publicKeysByVersion = await loadPublicKeys(publicKeys);

  async function getEntitlement() {
    const tokenStr = await storage.get('entitlementToken');
    if (tokenStr === null) {
      return { status: 'not_activated' };
    }

    const now = getNow();
    const storedLastValidatedAt = await storage.get('lastValidatedAt');
    // storage.get() resolves null for a missing key — pass that through as
    // null, NOT Number(null) (which is 0, a finite number). Coercing it
    // would silently defeat assertNoClockRollback's fail-closed guard for
    // "entitlementToken exists but no watermark has ever been written yet"
    // (the state before Phase 3's activate() has run).
    const lastValidatedAt = storedLastValidatedAt === null ? null : Number(storedLastValidatedAt);

    try {
      assertNoClockRollback({ now, lastValidatedAt });
    } catch (err) {
      if (err instanceof TypeError || err instanceof ClockRollbackDetectedError) {
        return { status: 'clock_rollback' };
      }
      throw err; // unexpected — propagate, never swallow into a fake status
    }

    // Ratchet the watermark forward now that the clock check has passed,
    // regardless of what verification below decides — the observation "now
    // is at least this far along" is true independent of this particular
    // token's own validity. This closes the gap where a NAIVE clock
    // rollback (rolling the clock back without also editing this stored
    // value) would let an already-observed-expired token look valid again.
    // It is NOT protection against an attacker who edits this file directly
    // alongside the clock — that requires the same local filesystem write
    // access the token file itself already assumes as the trust boundary
    // (ARCHITECTURE.md §5); no purely local, secret-free value can defend
    // against a party who can edit it directly. Accepted, documented
    // limitation — see PROGRESS.md's Phase 2 entry, same shape as §7's
    // revocation-propagation trade-off. Never reached on the rollback path
    // above, so a detected (or ambiguous) rollback never regresses the
    // stored watermark.
    await storage.set('lastValidatedAt', String(now));

    try {
      const payload = await verifyEntitlementToken(tokenStr, { publicKeysByVersion, now });

      // Reject replay of a superseded (but still validly-signed, still
      // unexpired) token: without this, restoring an old entitlementToken
      // file — e.g. one saved before a downgrade — verifies cleanly and
      // reports valid, since signature/expiry alone can't distinguish "the
      // current token" from "a still-unexpired token this installation
      // already moved past." Mirrors lastValidatedAt's watermark pattern,
      // but keyed on the signature-authenticated payload.issuedAt rather
      // than local clock time. Unlike lastValidatedAt, a missing watermark
      // here is NOT fail-closed: the first token an installation ever
      // verifies has nothing prior to compare against, so absence just
      // means "nothing seen yet," not "something is wrong."
      const storedHighestIssuedAt = await storage.get('highestIssuedAtSeen');
      const highestIssuedAtSeen =
        storedHighestIssuedAt === null ? null : Number(storedHighestIssuedAt);
      if (highestIssuedAtSeen !== null && payload.issuedAt < highestIssuedAtSeen) {
        return { status: 'tampered' };
      }
      if (highestIssuedAtSeen === null || payload.issuedAt > highestIssuedAtSeen) {
        await storage.set('highestIssuedAtSeen', String(payload.issuedAt));
      }

      return { status: 'valid', expiresAt: payload.expiresAt, features: payload.features };
    } catch (err) {
      if (err instanceof TokenExpiredError) return { status: 'expired' };
      if (err instanceof UnknownKeyVersionError) return { status: 'unknown_key_version' };
      if (err instanceof TokenInvalidError) return { status: 'tampered' };
      throw err; // unexpected — propagate, never swallow into a fake status
    }
  }

  return { getEntitlement };
}
