// Phase 3 — POST /activate, store tokens via the storage adapter.
//
// Closes three of Phase 2's carry-forward items (PROGRESS.md): writes the
// initial lastValidatedAt watermark (without it every post-activation
// getEntitlement() call fails closed with clock_rollback, permanently),
// seeds highestIssuedAtSeen, and stores the installationId entitlement.js
// now checks against. A human-initiated, one-time action — throws on any
// failure per ARCHITECTURE.md §4, never returns a status object.
//
// The received entitlementToken is verified locally (same crypto/ machinery
// getEntitlement() uses) before anything is persisted. This is the load-
// bearing defense against a MITM or malicious server: a compromised network
// path can return whatever JSON it likes, but it cannot forge a token that
// verifies against our configured public keys, so nothing this function
// stores can end up trusted-but-fraudulent.

import { randomUUID } from 'node:crypto';

import { loadPublicKeys } from './crypto/keys.js';
import { verifyEntitlementToken } from './crypto/verify.js';
import { KeyforgeApiError } from './network/errors.js';
import { apiErrorFromResponse, parseSuccessBody, postJson } from './network/request.js';

const defaultGetNow = () => Math.floor(Date.now() / 1000);

/**
 * @param {object} options
 * @param {import('./storage/adapter.js').StorageAdapter} options.storage
 * @param {Record<string, string>} options.publicKeys - keyVersion -> PEM string
 * @param {string} options.baseUrl - Keyforge base URL, e.g. 'https://licensing.example.com'
 * @param {() => number} [options.getNow]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ activate: (licenseKey: string) => Promise<{ expiresAt: number }> }>}
 */
export async function createActivateClient({
  storage,
  publicKeys,
  baseUrl,
  getNow = defaultGetNow,
  fetchImpl = fetch,
}) {
  const publicKeysByVersion = await loadPublicKeys(publicKeys);

  async function activate(licenseKey) {
    let installationFingerprint = await storage.get('installationFingerprint');
    if (installationFingerprint === null) {
      installationFingerprint = randomUUID();
      await storage.set('installationFingerprint', installationFingerprint);
    }

    const response = await postJson(
      baseUrl,
      '/api/v1/licenses/activate',
      { licenseKey, installationFingerprint },
      fetchImpl,
    );

    if (response.status !== 201) {
      throw await apiErrorFromResponse(response);
    }

    const body = await parseSuccessBody(response);
    const { entitlementToken, installationToken, installationId } = body?.data ?? {};
    if (
      typeof entitlementToken !== 'string' ||
      typeof installationToken !== 'string' ||
      typeof installationId !== 'string' ||
      installationId.length === 0
    ) {
      throw new KeyforgeApiError(
        response.status,
        'MALFORMED_RESPONSE',
        'activate() response is missing required fields',
      );
    }

    const now = getNow();
    // Verify before trusting anything else in the response — see module
    // comment. Left to propagate as-is (TokenInvalidError/TokenExpiredError/
    // UnknownKeyVersionError): a malformed/malicious/stale-key response here
    // is a genuine failure this one-time action should throw for, not a
    // status this module invents a mapping for.
    const payload = await verifyEntitlementToken(entitlementToken, { publicKeysByVersion, now });

    if (String(payload.installationId) !== installationId) {
      throw new KeyforgeApiError(
        response.status,
        'INSTALLATION_ID_MISMATCH',
        'activate() response installationId does not match the entitlement token payload',
      );
    }

    // Reject a stale or replayed response BEFORE persisting anything, same
    // defense as refresh() (see its module comment) — guards an
    // already-active installation against a MITM/malicious server replaying
    // an old, still-validly-signed /activate response. Only meaningful when
    // there's a prior watermark to compare against: a genuinely fresh
    // device, or one that just ran deactivate() (which clears this key),
    // has nothing to compare yet — same "absence isn't fail-closed"
    // reasoning entitlement.js already documents for this same field.
    const storedHighestIssuedAt = await storage.get('highestIssuedAtSeen');
    const highestIssuedAtSeen =
      storedHighestIssuedAt === null ? null : Number(storedHighestIssuedAt);
    if (highestIssuedAtSeen !== null && payload.issuedAt <= highestIssuedAtSeen) {
      throw new KeyforgeApiError(
        response.status,
        'STALE_TOKEN_REPLAY',
        'activate() response entitlementToken is not newer than the last one seen',
      );
    }

    await storage.set('entitlementToken', entitlementToken);
    await storage.set('installationToken', installationToken);
    await storage.set('installationId', payload.installationId);
    await storage.set('lastValidatedAt', String(now));
    await storage.set('highestIssuedAtSeen', String(payload.issuedAt));
    await storage.delete('revoked');

    return { expiresAt: payload.expiresAt };
  }

  return { activate };
}
