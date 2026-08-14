import { assertValidKey, assertValidValue } from '../../src/storage/adapter.js';

/**
 * In-memory StorageAdapter test double (ARCHITECTURE.md §10) — proves the
 * StorageAdapter interface is genuinely swappable, and gives later phases'
 * test suites a real-storage-free double to inject instead of touching disk.
 *
 * @returns {import('../../src/storage/adapter.js').StorageAdapter}
 */
export function createMemoryAdapter() {
  const store = new Map();

  return {
    async get(key) {
      assertValidKey(key);
      return store.has(key) ? store.get(key) : null;
    },

    async set(key, value) {
      assertValidKey(key);
      assertValidValue(value);
      store.set(key, value);
    },

    async delete(key) {
      assertValidKey(key);
      store.delete(key);
    },
  };
}
