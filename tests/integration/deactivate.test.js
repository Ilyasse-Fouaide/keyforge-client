import { describe, expect, it } from 'vitest';

import { createDeactivateClient } from '../../src/deactivate.js';
import { emptyResponse, jsonResponse, queueFetch, unreachableFetch } from '../helpers/fakeFetch.js';
import { createMemoryAdapter } from '../helpers/memoryAdapter.js';

const BASE_URL = 'https://keyforge.example.test';

describe('deactivate() (mocked-API integration)', () => {
  async function seedActivatedStorage(storage) {
    await storage.set('entitlementToken', 'entitlement-token-value');
    await storage.set('installationToken', 'install-token-xyz');
    await storage.set('installationId', 'inst_abc');
    await storage.set('lastValidatedAt', '1000');
    await storage.set('highestIssuedAtSeen', '900');
    await storage.set('installationFingerprint', 'fingerprint-should-survive');
  }

  it('no-ops when nothing is stored (never activated)', async () => {
    const storage = createMemoryAdapter();
    const fetchImpl = queueFetch([]);

    const { deactivate } = await createDeactivateClient({ storage, baseUrl: BASE_URL, fetchImpl });
    await expect(deactivate()).resolves.toBeUndefined();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('sends the stored installationToken and clears license state on a 204, keeping the fingerprint', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = queueFetch([emptyResponse(204)]);

    const { deactivate } = await createDeactivateClient({ storage, baseUrl: BASE_URL, fetchImpl });
    await deactivate();

    expect(fetchImpl.calls[0].url).toBe(`${BASE_URL}/api/v1/licenses/deactivate`);
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({
      installationToken: 'install-token-xyz',
    });

    await expect(storage.get('entitlementToken')).resolves.toBeNull();
    await expect(storage.get('installationToken')).resolves.toBeNull();
    await expect(storage.get('installationId')).resolves.toBeNull();
    await expect(storage.get('lastValidatedAt')).resolves.toBeNull();
    await expect(storage.get('highestIssuedAtSeen')).resolves.toBeNull();
    await expect(storage.get('revoked')).resolves.toBeNull();
    await expect(storage.get('installationFingerprint')).resolves.toBe(
      'fingerprint-should-survive',
    );
  });

  it('also clears a previously set revoked flag on success', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    await storage.set('revoked', 'true');
    const fetchImpl = queueFetch([emptyResponse(204)]);

    const { deactivate } = await createDeactivateClient({ storage, baseUrl: BASE_URL, fetchImpl });
    await deactivate();

    await expect(storage.get('revoked')).resolves.toBeNull();
  });

  it('throws KeyforgeApiError on a non-204 response and leaves storage untouched', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = queueFetch([
      jsonResponse(401, {
        error: { code: 'INSTALLATION_TOKEN_INVALID', message: 'Unknown token' },
      }),
    ]);

    const { deactivate } = await createDeactivateClient({ storage, baseUrl: BASE_URL, fetchImpl });
    await expect(deactivate()).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      status: 401,
      code: 'INSTALLATION_TOKEN_INVALID',
    });
    await expect(storage.get('installationToken')).resolves.toBe('install-token-xyz');
  });

  it('propagates a network failure as a throw (unlike refresh(), never silently no-ops)', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = unreachableFetch();

    const { deactivate } = await createDeactivateClient({ storage, baseUrl: BASE_URL, fetchImpl });
    await expect(deactivate()).rejects.toThrow();
    await expect(storage.get('installationToken')).resolves.toBe('install-token-xyz');
  });
});
