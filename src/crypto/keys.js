// Phase 2 — new helper, not a port. Keyforge server loads public keys from
// a file-path manifest (its own src/crypto/keys.js); this module's own §8
// resolution is inline PEM strings supplied at init instead (see
// ARCHITECTURE.md §8 and PROGRESS.md's Phase 2 entry for the rationale) —
// this file only owns the PEM-string -> CryptoKey conversion, no file I/O.

import { importSPKI } from 'jose';

/**
 * Converts a `{ [keyVersion]: pemString }` config into the
 * `Map<string, CryptoKey>` shape verifyEntitlementToken expects, keyed by
 * version-as-string to match the JWS `kid` header (spec-string-typed).
 * @param {Record<string, string>} publicKeys
 * @returns {Promise<Map<string, CryptoKey>>}
 */
export async function loadPublicKeys(publicKeys) {
  if (publicKeys === null || typeof publicKeys !== 'object' || Array.isArray(publicKeys)) {
    throw new TypeError('publicKeys must be an object mapping keyVersion to a PEM string');
  }

  const entries = Object.entries(publicKeys);
  if (entries.length === 0) {
    throw new TypeError('publicKeys must contain at least one key');
  }

  const resolved = await Promise.all(
    entries.map(async ([version, pem]) => {
      if (typeof pem !== 'string' || pem.length === 0) {
        throw new TypeError(`publicKeys['${version}'] must be a non-empty PEM string`);
      }
      try {
        return [version, await importSPKI(pem, 'EdDSA')];
      } catch (err) {
        throw new TypeError(`publicKeys['${version}'] is not a valid EdDSA public key PEM`, {
          cause: err,
        });
      }
    }),
  );

  return new Map(resolved);
}
