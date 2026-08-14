import { describe, expect, it } from 'vitest';

/**
 * Runs the full StorageAdapter contract (ARCHITECTURE.md §5) against
 * whatever adapter `createAdapter()` returns, so every implementation is
 * proven to behave identically against the same test cases.
 *
 * @param {() => import('../../src/storage/adapter.js').StorageAdapter} createAdapter
 */
export function runStorageAdapterContractTests(createAdapter) {
  describe('StorageAdapter contract', () => {
    it('returns the value set for a key', async () => {
      const adapter = createAdapter();
      await adapter.set('entitlementToken', 'abc.def.ghi');
      await expect(adapter.get('entitlementToken')).resolves.toBe('abc.def.ghi');
    });

    it('returns null for a key that was never set', async () => {
      const adapter = createAdapter();
      await expect(adapter.get('neverSet')).resolves.toBeNull();
    });

    it('removes a key on delete, so a later get returns null', async () => {
      const adapter = createAdapter();
      await adapter.set('installationToken', 'xyz');
      await adapter.delete('installationToken');
      await expect(adapter.get('installationToken')).resolves.toBeNull();
    });

    it('is a no-op to delete a key that was never set', async () => {
      const adapter = createAdapter();
      await expect(adapter.delete('neverSet')).resolves.toBeUndefined();
    });

    it('overwrites an existing key on set', async () => {
      const adapter = createAdapter();
      await adapter.set('key', 'first');
      await adapter.set('key', 'second');
      await expect(adapter.get('key')).resolves.toBe('second');
    });

    it('keeps distinct keys independent', async () => {
      const adapter = createAdapter();
      await adapter.set('entitlementToken', 'entitlement-value');
      await adapter.set('installationToken', 'installation-value');

      await expect(adapter.get('entitlementToken')).resolves.toBe('entitlement-value');
      await expect(adapter.get('installationToken')).resolves.toBe('installation-value');
    });

    it('rejects a non-string value on set', async () => {
      const adapter = createAdapter();
      await expect(adapter.set('key', 42)).rejects.toThrow(TypeError);
    });

    it.each([
      ['get', (adapter, key) => adapter.get(key)],
      ['set', (adapter, key) => adapter.set(key, 'value')],
      ['delete', (adapter, key) => adapter.delete(key)],
    ])('%s rejects a non-string key', async (_name, call) => {
      const adapter = createAdapter();
      await expect(call(adapter, 42)).rejects.toThrow(TypeError);
    });

    it.each([
      ['get', (adapter, key) => adapter.get(key)],
      ['set', (adapter, key) => adapter.set(key, 'value')],
      ['delete', (adapter, key) => adapter.delete(key)],
    ])('%s rejects an empty-string key', async (_name, call) => {
      const adapter = createAdapter();
      await expect(call(adapter, '')).rejects.toThrow(TypeError);
    });

    it('does not lose an update when concurrent sets target different keys', async () => {
      const adapter = createAdapter();
      await Promise.all([adapter.set('keyA', 'valueA'), adapter.set('keyB', 'valueB')]);

      await expect(adapter.get('keyA')).resolves.toBe('valueA');
      await expect(adapter.get('keyB')).resolves.toBe('valueB');
    });
  });
}
