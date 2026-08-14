// Phase 4 — public API surface.
//
// Composes the four independent lifecycle factories (Phases 2-3) into one
// client, constructed once from a single shared config object, exposing
// exactly ARCHITECTURE.md §4's literal call shapes: activate(licenseKey),
// getEntitlement(), refresh(), deactivate(). Each sub-factory destructures
// only the config keys it needs, so the same object is safe to pass to all
// four (e.g. createDeactivateClient simply ignores publicKeys/getNow).
//
// storage defaults to a plain JSON-file adapter when omitted, continuing
// this project's already-settled "default storage is a plain JSON file"
// decision (ARCHITECTURE.md §5, CLAUDE.md) up to this composed-client level.

import { createActivateClient } from './activate.js';
import { createDeactivateClient } from './deactivate.js';
import { createEntitlementChecker } from './entitlement.js';
import { createRefreshClient } from './refresh.js';
import { createJsonFileAdapter } from './storage/json-file.js';

/**
 * @param {object} options
 * @param {import('./storage/adapter.js').StorageAdapter} [options.storage] - defaults to a JSON-file adapter at the default path
 * @param {Record<string, string>} options.publicKeys - keyVersion -> PEM string
 * @param {string} options.baseUrl - Keyforge base URL, e.g. 'https://licensing.example.com'
 * @param {() => number} [options.getNow]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{
 *   activate: (licenseKey: string) => Promise<{ expiresAt: number }>,
 *   getEntitlement: () => Promise<object>,
 *   refresh: () => Promise<object>,
 *   deactivate: () => Promise<void>,
 * }>}
 */
export async function createKeyforgeClient({
  storage = createJsonFileAdapter(),
  publicKeys,
  baseUrl,
  getNow,
  fetchImpl,
}) {
  const sharedConfig = { storage, publicKeys, baseUrl, getNow, fetchImpl };

  const [activateClient, entitlementChecker, refreshClient, deactivateClient] = await Promise.all([
    createActivateClient(sharedConfig),
    createEntitlementChecker(sharedConfig),
    createRefreshClient(sharedConfig),
    createDeactivateClient(sharedConfig),
  ]);

  return {
    activate: activateClient.activate,
    getEntitlement: entitlementChecker.getEntitlement,
    refresh: refreshClient.refresh,
    deactivate: deactivateClient.deactivate,
  };
}
