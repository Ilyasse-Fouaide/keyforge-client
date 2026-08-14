import { beforeAll, describe, expect, it } from 'vitest';

import { createEntitlementChecker } from '../../src/entitlement.js';
import { createRefreshClient } from '../../src/refresh.js';
import { buildEntitlementPayload, generateTestKeyPair, signTestToken } from '../helpers/crypto.js';
import { emptyResponse, jsonResponse, queueFetch, unreachableFetch } from '../helpers/fakeFetch.js';
import { createMemoryAdapter } from '../helpers/memoryAdapter.js';

const BASE_URL = 'https://keyforge.example.test';

describe('refresh() (mocked-API integration)', () => {
  let keyPair;

  beforeAll(async () => {
    keyPair = await generateTestKeyPair();
  });

  async function createClient({ storage, fetchImpl, getNow }) {
    return createRefreshClient({
      storage,
      publicKeys: { 1: keyPair.publicKeyPem },
      baseUrl: BASE_URL,
      fetchImpl,
      getNow,
    });
  }

  /** Seeds storage as if activate() already ran. */
  async function seedActivatedStorage(storage, { installationId = 'inst_abc' } = {}) {
    await storage.set('installationToken', 'install-token-xyz');
    await storage.set('installationId', installationId);
    await storage.set('entitlementToken', 'placeholder-not-checked-by-refresh-input');
    await storage.set('lastValidatedAt', '1000');
    await storage.set('highestIssuedAtSeen', '900');
  }

  async function refreshResponse({ installationId = 'inst_abc', claimOverrides = {} } = {}) {
    const claims = buildEntitlementPayload({ installationId, ...claimOverrides });
    const entitlementToken = await signTestToken(claims, {
      privateKey: keyPair.privateKey,
      kid: '1',
    });
    return {
      response: jsonResponse(200, { data: { entitlementToken, expiresAt: claims.expiresAt } }),
      claims,
      entitlementToken,
    };
  }

  it('returns not_activated and makes no network call when nothing is stored', async () => {
    const storage = createMemoryAdapter();
    const fetchImpl = queueFetch([]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).resolves.toEqual({ status: 'not_activated' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('updates entitlementToken and ratchets both watermarks on success', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const { response, claims, entitlementToken } = await refreshResponse({
      claimOverrides: { issuedAt: 2000, expiresAt: 5000 },
    });
    const fetchImpl = queueFetch([response]);
    const now = 2100;

    const { refresh } = await createClient({ storage, fetchImpl, getNow: () => now });
    await expect(refresh()).resolves.toEqual({ status: 'updated', expiresAt: claims.expiresAt });

    await expect(storage.get('entitlementToken')).resolves.toBe(entitlementToken);
    await expect(storage.get('lastValidatedAt')).resolves.toBe(String(now));
    await expect(storage.get('highestIssuedAtSeen')).resolves.toBe(String(claims.issuedAt));
  });

  it('sends the stored installationToken as the request body', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const { response } = await refreshResponse();
    const fetchImpl = queueFetch([response]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await refresh();

    expect(fetchImpl.calls[0].url).toBe(`${BASE_URL}/api/v1/licenses/refresh`);
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({
      installationToken: 'install-token-xyz',
    });
  });

  it('silently no-ops when the server is unreachable, leaving storage untouched', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = unreachableFetch();

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).resolves.toEqual({ status: 'offline' });

    await expect(storage.get('lastValidatedAt')).resolves.toBe('1000');
    await expect(storage.get('revoked')).resolves.toBeNull();
  });

  it('silently no-ops on a 429 RATE_LIMITED response', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = queueFetch([
      jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
    ]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).resolves.toEqual({ status: 'offline' });
    await expect(storage.get('lastValidatedAt')).resolves.toBe('1000');
  });

  it('marks revoked on a 403 response, and a subsequent getEntitlement() reports revoked', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = queueFetch([
      jsonResponse(403, {
        error: { code: 'LICENSE_REVOKED', message: 'License has been revoked' },
      }),
    ]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).resolves.toEqual({ status: 'revoked' });
    await expect(storage.get('revoked')).resolves.toBe('true');

    const { getEntitlement } = await createEntitlementChecker({
      storage,
      publicKeys: { 1: keyPair.publicKeyPem },
    });
    await expect(getEntitlement()).resolves.toEqual({ status: 'revoked' });
  });

  it('rejects a replayed old /refresh response and does NOT clear a revoked flag set since (security review finding)', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    // The attacker's captured response: a genuine, validly-signed token
    // this installation already accepted once (issuedAt matches the
    // pre-seeded highestIssuedAtSeen exactly — the strictest replay case).
    const { response: capturedResponse } = await refreshResponse({
      claimOverrides: { issuedAt: 900, expiresAt: 5000 },
    });
    // The server has since revoked the license; a real refresh() reports
    // that. Then the attacker replays the captured (pre-revocation)
    // response on a later refresh() call.
    const fetchImpl = queueFetch([
      jsonResponse(403, {
        error: { code: 'LICENSE_REVOKED', message: 'License has been revoked' },
      }),
      capturedResponse,
    ]);

    const { refresh } = await createClient({ storage, fetchImpl, getNow: () => 1000 });
    await expect(refresh()).resolves.toEqual({ status: 'revoked' });
    await expect(storage.get('revoked')).resolves.toBe('true');

    await expect(refresh()).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'STALE_TOKEN_REPLAY',
    });

    // The replay must not have cleared the revocation or rolled back state.
    await expect(storage.get('revoked')).resolves.toBe('true');
    await expect(storage.get('entitlementToken')).resolves.toBe(
      'placeholder-not-checked-by-refresh-input',
    );
    await expect(storage.get('highestIssuedAtSeen')).resolves.toBe('900');

    const { getEntitlement } = await createEntitlementChecker({
      storage,
      publicKeys: { 1: keyPair.publicKeyPem },
      getNow: () => 1000,
    });
    await expect(getEntitlement()).resolves.toEqual({ status: 'revoked' });
  });

  it('rejects a refresh response that is not strictly newer than the last accepted token', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage); // highestIssuedAtSeen = '900'
    const { response } = await refreshResponse({
      claimOverrides: { issuedAt: 900, expiresAt: 5000 },
    });
    const fetchImpl = queueFetch([response]);

    const { refresh } = await createClient({ storage, fetchImpl, getNow: () => 1000 });
    await expect(refresh()).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'STALE_TOKEN_REPLAY',
    });
    await expect(storage.get('entitlementToken')).resolves.toBe(
      'placeholder-not-checked-by-refresh-input',
    );
  });

  it('clears a previously set revoked flag on a later successful refresh', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    await storage.set('revoked', 'true');
    const { response, claims } = await refreshResponse({
      claimOverrides: { issuedAt: 2000, expiresAt: 5000 },
    });
    const fetchImpl = queueFetch([response]);

    const { refresh } = await createClient({ storage, fetchImpl, getNow: () => 2100 });
    await expect(refresh()).resolves.toEqual({ status: 'updated', expiresAt: claims.expiresAt });
    await expect(storage.get('revoked')).resolves.toBeNull();

    const { getEntitlement } = await createEntitlementChecker({
      storage,
      publicKeys: { 1: keyPair.publicKeyPem },
      getNow: () => 2100,
    });
    await expect(getEntitlement()).resolves.toMatchObject({ status: 'valid' });
  });

  it('rejects a 200 response with a malformed (non-JSON) body as KeyforgeApiError, not a raw SyntaxError', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = queueFetch([emptyResponse(200)]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('throws KeyforgeApiError on an unexpected response (401 INSTALLATION_TOKEN_INVALID)', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const fetchImpl = queueFetch([
      jsonResponse(401, {
        error: { code: 'INSTALLATION_TOKEN_INVALID', message: 'Unknown token' },
      }),
    ]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      status: 401,
      code: 'INSTALLATION_TOKEN_INVALID',
    });
  });

  it('rejects a response whose entitlementToken fails signature verification, without persisting anything', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage);
    const attackerKeyPair = await generateTestKeyPair();
    const claims = buildEntitlementPayload({ installationId: 'inst_abc' });
    const forgedToken = await signTestToken(claims, {
      privateKey: attackerKeyPair.privateKey,
      kid: '1',
    });
    const fetchImpl = queueFetch([
      jsonResponse(200, { data: { entitlementToken: forgedToken, expiresAt: claims.expiresAt } }),
    ]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).rejects.toThrow();
    await expect(storage.get('entitlementToken')).resolves.toBe(
      'placeholder-not-checked-by-refresh-input',
    );
  });

  it('rejects a validly-signed response for a different installation, without persisting anything', async () => {
    const storage = createMemoryAdapter();
    await seedActivatedStorage(storage, { installationId: 'inst_abc' });
    const { response } = await refreshResponse({ installationId: 'inst_someone_else' });
    const fetchImpl = queueFetch([response]);

    const { refresh } = await createClient({ storage, fetchImpl });
    await expect(refresh()).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'INSTALLATION_ID_MISMATCH',
    });
    await expect(storage.get('entitlementToken')).resolves.toBe(
      'placeholder-not-checked-by-refresh-input',
    );
  });
});
