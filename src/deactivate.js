// Phase 3 — POST /deactivate for branch decommissioning.
//
// A deliberate, human-initiated action — throws on any failure (including
// network unreachability, unlike refresh()) per ARCHITECTURE.md §4. On
// success, clears all locally stored license-activation state so a
// subsequent getEntitlement() call reports the existing 'not_activated'
// status — no new vocabulary needed. installationFingerprint is
// deliberately kept: it identifies this device, not this activation, and
// survives across a future re-activation.

import { apiErrorFromResponse, postJson } from './network/request.js';

/**
 * @param {object} options
 * @param {import('./storage/adapter.js').StorageAdapter} options.storage
 * @param {string} options.baseUrl
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ deactivate: () => Promise<void> }>}
 */
export async function createDeactivateClient({ storage, baseUrl, fetchImpl = fetch }) {
  async function deactivate() {
    const installationToken = await storage.get('installationToken');
    if (installationToken === null) {
      return; // nothing to deactivate
    }

    const response = await postJson(
      baseUrl,
      '/api/v1/licenses/deactivate',
      { installationToken },
      fetchImpl,
    );

    if (response.status !== 204) {
      throw await apiErrorFromResponse(response);
    }

    await storage.delete('entitlementToken');
    await storage.delete('installationToken');
    await storage.delete('installationId');
    await storage.delete('lastValidatedAt');
    await storage.delete('highestIssuedAtSeen');
    await storage.delete('revoked');
  }

  return { deactivate };
}
