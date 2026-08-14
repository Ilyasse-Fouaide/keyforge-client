import { beforeAll, describe, expect, it } from 'vitest';

import { createActivateClient } from '../../src/activate.js';
import { KeyforgeApiError } from '../../src/network/errors.js';
import { buildEntitlementPayload, generateTestKeyPair, signTestToken } from '../helpers/crypto.js';
import { emptyResponse, jsonResponse, queueFetch } from '../helpers/fakeFetch.js';
import { createMemoryAdapter } from '../helpers/memoryAdapter.js';

const BASE_URL = 'https://keyforge.example.test';

describe('activate() (mocked-API integration)', () => {
  let keyPair;

  beforeAll(async () => {
    keyPair = await generateTestKeyPair();
  });

  async function createClient({ storage, fetchImpl, getNow }) {
    return createActivateClient({
      storage,
      publicKeys: { 1: keyPair.publicKeyPem },
      baseUrl: BASE_URL,
      fetchImpl,
      getNow,
    });
  }

  /** Builds a real signed /activate 201 response, self-consistent by default. */
  async function activationResponse({
    installationId = 'inst_abc',
    installationToken = 'install-token-xyz',
    claimOverrides = {},
    privateKey = keyPair.privateKey,
    kid = '1',
  } = {}) {
    const claims = buildEntitlementPayload({ installationId, ...claimOverrides });
    const entitlementToken = await signTestToken(claims, { privateKey, kid });
    return {
      response: jsonResponse(201, {
        data: { entitlementToken, installationToken, installationId, expiresAt: claims.expiresAt },
      }),
      claims,
      entitlementToken,
    };
  }

  it('populates entitlementToken, installationToken, installationId, and both watermarks on success', async () => {
    const storage = createMemoryAdapter();
    const { response, claims, entitlementToken } = await activationResponse();
    const fetchImpl = queueFetch([response]);
    const now = 1_700_000_500;

    const { activate } = await createClient({ storage, fetchImpl, getNow: () => now });
    const result = await activate('KF-TEST-LICENSE-KEY');

    expect(result).toEqual({ expiresAt: claims.expiresAt });
    await expect(storage.get('entitlementToken')).resolves.toBe(entitlementToken);
    await expect(storage.get('installationToken')).resolves.toBe('install-token-xyz');
    await expect(storage.get('installationId')).resolves.toBe('inst_abc');
    await expect(storage.get('lastValidatedAt')).resolves.toBe(String(now));
    await expect(storage.get('highestIssuedAtSeen')).resolves.toBe(String(claims.issuedAt));
  });

  it('sends the request to the configured base URL with the license key and a fingerprint', async () => {
    const storage = createMemoryAdapter();
    const { response } = await activationResponse();
    const fetchImpl = queueFetch([response]);

    const { activate } = await createClient({ storage, fetchImpl });
    await activate('KF-TEST-LICENSE-KEY');

    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe(`${BASE_URL}/api/v1/licenses/activate`);
    const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sentBody.licenseKey).toBe('KF-TEST-LICENSE-KEY');
    expect(typeof sentBody.installationFingerprint).toBe('string');
    expect(sentBody.installationFingerprint.length).toBeGreaterThan(0);
  });

  it('generates installationFingerprint once and reuses it on a later activate() call', async () => {
    const storage = createMemoryAdapter();
    // Distinct, increasing issuedAt values: activate()'s stale-token-replay
    // guard would otherwise reject the second call if both tokens happened
    // to land in the same wall-clock second as the first.
    const first = await activationResponse({ claimOverrides: { issuedAt: 1_700_000_000 } });
    const second = await activationResponse({ claimOverrides: { issuedAt: 1_700_000_100 } });
    const fetchImpl = queueFetch([first.response, second.response]);

    const { activate } = await createClient({ storage, fetchImpl });
    await activate('KF-TEST-LICENSE-KEY');
    const firstFingerprint = JSON.parse(fetchImpl.calls[0].init.body).installationFingerprint;

    await activate('KF-TEST-LICENSE-KEY');
    const secondFingerprint = JSON.parse(fetchImpl.calls[1].init.body).installationFingerprint;

    expect(secondFingerprint).toBe(firstFingerprint);
    await expect(storage.get('installationFingerprint')).resolves.toBe(firstFingerprint);
  });

  it('clears a stale revoked flag on a successful (re-)activation', async () => {
    const storage = createMemoryAdapter();
    await storage.set('revoked', 'true');
    const { response } = await activationResponse();
    const fetchImpl = queueFetch([response]);

    const { activate } = await createClient({ storage, fetchImpl });
    await activate('KF-TEST-LICENSE-KEY');

    await expect(storage.get('revoked')).resolves.toBeNull();
  });

  it('throws KeyforgeApiError on a non-201 response and persists nothing', async () => {
    const storage = createMemoryAdapter();
    const fetchImpl = queueFetch([
      jsonResponse(401, { error: { code: 'LICENSE_INVALID', message: 'Invalid license key' } }),
    ]);

    const { activate } = await createClient({ storage, fetchImpl });

    await expect(activate('KF-BAD-KEY')).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      status: 401,
      code: 'LICENSE_INVALID',
    });
    await expect(storage.get('entitlementToken')).resolves.toBeNull();
  });

  it('rejects a response whose entitlementToken fails signature verification, without persisting anything', async () => {
    const storage = createMemoryAdapter();
    const attackerKeyPair = await generateTestKeyPair();
    // Signed by a key we don't trust, but labeled with a kid ('1') our
    // configured publicKeys DOES recognize — simulates a MITM/malicious
    // server response: signature verification against our real public key
    // must fail, not silently pass because the kid looked familiar.
    const { response } = await activationResponse({ privateKey: attackerKeyPair.privateKey });
    const fetchImpl = queueFetch([response]);

    const { activate } = await createClient({ storage, fetchImpl });

    await expect(activate('KF-TEST-LICENSE-KEY')).rejects.toThrow();
    await expect(storage.get('entitlementToken')).resolves.toBeNull();
    await expect(storage.get('installationToken')).resolves.toBeNull();
    await expect(storage.get('installationId')).resolves.toBeNull();
  });

  it('rejects a response whose top-level installationId does not match the token payload, without persisting anything', async () => {
    const storage = createMemoryAdapter();
    const claims = buildEntitlementPayload({ installationId: 'inst_real' });
    const entitlementToken = await signTestToken(claims, {
      privateKey: keyPair.privateKey,
      kid: '1',
    });
    const response = jsonResponse(201, {
      data: {
        entitlementToken,
        installationToken: 'install-token-xyz',
        installationId: 'inst_different', // mismatched vs. the signed payload
        expiresAt: claims.expiresAt,
      },
    });
    const fetchImpl = queueFetch([response]);

    const { activate } = await createClient({ storage, fetchImpl });

    await expect(activate('KF-TEST-LICENSE-KEY')).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'INSTALLATION_ID_MISMATCH',
    });
    await expect(storage.get('entitlementToken')).resolves.toBeNull();
  });

  it('rejects a replayed old /activate response against an already-active installation (security review finding)', async () => {
    const storage = createMemoryAdapter();
    await storage.set('highestIssuedAtSeen', '900'); // simulates prior activate()/refresh() already ran
    const { response } = await activationResponse({ claimOverrides: { issuedAt: 900 } });
    const fetchImpl = queueFetch([response]);

    const { activate } = await createClient({ storage, fetchImpl });

    await expect(activate('KF-TEST-LICENSE-KEY')).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'STALE_TOKEN_REPLAY',
    });
    await expect(storage.get('entitlementToken')).resolves.toBeNull();
    await expect(storage.get('highestIssuedAtSeen')).resolves.toBe('900');
  });

  it('rejects a response missing required fields as KeyforgeApiError', async () => {
    const storage = createMemoryAdapter();
    const fetchImpl = queueFetch([jsonResponse(201, { data: { expiresAt: 123 } })]);

    const { activate } = await createClient({ storage, fetchImpl });

    await expect(activate('KF-TEST-LICENSE-KEY')).rejects.toBeInstanceOf(KeyforgeApiError);
  });

  it('rejects a 201 response with a malformed (non-JSON) body as KeyforgeApiError, not a raw SyntaxError', async () => {
    const storage = createMemoryAdapter();
    const fetchImpl = queueFetch([emptyResponse(201)]);

    const { activate } = await createClient({ storage, fetchImpl });

    await expect(activate('KF-TEST-LICENSE-KEY')).rejects.toMatchObject({
      name: 'KeyforgeApiError',
      code: 'MALFORMED_RESPONSE',
    });
  });
});
