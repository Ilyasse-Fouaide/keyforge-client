// Phase 3 — POST /refresh, connectivity-gated, silent no-op offline.
//
// Closes Phase 2's other carry-forward item: gives refresh() a way to record
// a server-reported revocation so getEntitlement() can ever report
// 'revoked' (PROGRESS.md). Unlike activate()/deactivate(), this must never
// throw for "offline" or "try again later" (unreachable network, 429
// RATE_LIMITED) — those are expected, routine outcomes for a background
// operation. It DOES throw for genuinely unexpected server responses (e.g.
// 401 INSTALLATION_TOKEN_INVALID, 5xx, malformed body).
//
// The received entitlementToken is verified locally before being persisted,
// same MITM defense as activate() — a response arrives over the same
// network path and deserves the same signature gate before being trusted.

import { loadPublicKeys } from './crypto/keys.js';
import { verifyEntitlementToken } from './crypto/verify.js';
import { KeyforgeApiError } from './network/errors.js';
import { apiErrorFromResponse, parseSuccessBody, postJson } from './network/request.js';

const defaultGetNow = () => Math.floor(Date.now() / 1000);

/**
 * @param {object} options
 * @param {import('./storage/adapter.js').StorageAdapter} options.storage
 * @param {Record<string, string>} options.publicKeys - keyVersion -> PEM string
 * @param {string} options.baseUrl
 * @param {() => number} [options.getNow]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ refresh: () => Promise<object> }>}
 */
export async function createRefreshClient({
  storage,
  publicKeys,
  baseUrl,
  getNow = defaultGetNow,
  fetchImpl = fetch,
}) {
  const publicKeysByVersion = await loadPublicKeys(publicKeys);

  async function refresh() {
    const installationToken = await storage.get('installationToken');
    if (installationToken === null) {
      return { status: 'not_activated' };
    }

    let response;
    try {
      response = await postJson(
        baseUrl,
        '/api/v1/licenses/refresh',
        { installationToken },
        fetchImpl,
      );
    } catch {
      // Real connectivity check: attempt-and-catch, never a
      // navigator.onLine-style flag. Silent no-op, no state change.
      return { status: 'offline' };
    }

    if (response.status === 429) {
      // Same "try again later" bucket as unreachable — never throw for it.
      return { status: 'offline' };
    }

    if (response.status === 403) {
      await storage.set('revoked', 'true');
      return { status: 'revoked' };
    }

    if (response.status !== 200) {
      // Genuinely unexpected (401 INSTALLATION_TOKEN_INVALID, 400, 5xx, ...).
      throw await apiErrorFromResponse(response);
    }

    const body = await parseSuccessBody(response);
    const { entitlementToken } = body?.data ?? {};
    if (typeof entitlementToken !== 'string') {
      throw new KeyforgeApiError(
        response.status,
        'MALFORMED_RESPONSE',
        'refresh() response is missing entitlementToken',
      );
    }

    const now = getNow();
    const payload = await verifyEntitlementToken(entitlementToken, { publicKeysByVersion, now });

    const storedInstallationId = await storage.get('installationId');
    if (storedInstallationId !== null && String(payload.installationId) !== storedInstallationId) {
      throw new KeyforgeApiError(
        response.status,
        'INSTALLATION_ID_MISMATCH',
        'refresh() response entitlementToken belongs to a different installation',
      );
    }

    // Reject a stale or replayed response BEFORE persisting anything: a
    // MITM (or malicious server) that captured a previously-accepted
    // /refresh response must not be able to replay it later to roll
    // entitlementToken back to an already-superseded token or — the
    // critical case — to clear a `revoked` flag set by a real 403 that
    // arrived after the captured response. Strictly-greater-than (not >=)
    // rejects exact replays too: an honest refresh() always returns a token
    // with a newer issuedAt than the last one this installation accepted.
    const storedHighestIssuedAt = await storage.get('highestIssuedAtSeen');
    const highestIssuedAtSeen =
      storedHighestIssuedAt === null ? null : Number(storedHighestIssuedAt);
    if (highestIssuedAtSeen !== null && payload.issuedAt <= highestIssuedAtSeen) {
      throw new KeyforgeApiError(
        response.status,
        'STALE_TOKEN_REPLAY',
        'refresh() response entitlementToken is not newer than the last one seen',
      );
    }

    await storage.set('entitlementToken', entitlementToken);
    await storage.set('lastValidatedAt', String(now));
    await storage.set('highestIssuedAtSeen', String(payload.issuedAt));
    await storage.delete('revoked');

    return { status: 'updated', expiresAt: payload.expiresAt };
  }

  return { refresh };
}
