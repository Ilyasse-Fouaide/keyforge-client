import { describe, expect, it } from 'vitest';

import { loadPublicKeys } from '../../../src/crypto/keys.js';
import { verifyEntitlementToken } from '../../../src/crypto/verify.js';
import {
  buildEntitlementPayload,
  generateTestKeyPair,
  signTestToken,
} from '../../helpers/crypto.js';

describe('loadPublicKeys', () => {
  it('resolves a Map keyed by keyVersion from a { version: pem } config', async () => {
    const { publicKeyPem } = await generateTestKeyPair();

    const result = await loadPublicKeys({ 1: publicKeyPem });

    expect(result).toBeInstanceOf(Map);
    expect(result.has('1')).toBe(true);
  });

  it('resolves multiple key versions independently', async () => {
    const first = await generateTestKeyPair();
    const second = await generateTestKeyPair();

    const result = await loadPublicKeys({ 1: first.publicKeyPem, 2: second.publicKeyPem });

    expect(result.size).toBe(2);
    expect(result.has('1')).toBe(true);
    expect(result.has('2')).toBe(true);
  });

  it('resolves keys that are actually usable by verifyEntitlementToken, not just present', async () => {
    const { privateKey, publicKeyPem } = await generateTestKeyPair();
    const claims = buildEntitlementPayload();
    const jws = await signTestToken(claims, { privateKey, kid: '1' });

    const publicKeysByVersion = await loadPublicKeys({ 1: publicKeyPem });
    const payload = await verifyEntitlementToken(jws, {
      publicKeysByVersion,
      now: claims.issuedAt,
    });

    expect(payload).toMatchObject(claims);
  });

  it.each([
    ['null', null],
    ['a string', 'not-an-object'],
    ['an array', ['not-an-object']],
  ])('rejects %s as the top-level publicKeys config with TypeError', async (_name, value) => {
    await expect(loadPublicKeys(value)).rejects.toThrow(TypeError);
  });

  it('rejects an empty object with TypeError', async () => {
    await expect(loadPublicKeys({})).rejects.toThrow(TypeError);
  });

  it('rejects an invalid PEM with a TypeError naming the offending key version', async () => {
    await expect(loadPublicKeys({ 1: 'not-a-real-pem' })).rejects.toMatchObject({
      name: 'TypeError',
      message: expect.stringContaining("'1'"),
    });
  });

  it('rejects a non-string value with TypeError', async () => {
    await expect(loadPublicKeys({ 1: 12345 })).rejects.toThrow(TypeError);
  });
});
