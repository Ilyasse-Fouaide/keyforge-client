// Phase 1 — storage interface: get(key)/set(key,value)/delete(key).

/**
 * @typedef {object} StorageAdapter
 * @property {(key: string) => Promise<string | null>} get
 *   Resolves to the stored value, or `null` if `key` was never set. Never throws for a missing key.
 * @property {(key: string, value: string) => Promise<void>} set
 *   Stores `value` under `key`, overwriting any existing value.
 * @property {(key: string) => Promise<void>} delete
 *   Removes `key`. A no-op (does not throw) if `key` was never set.
 */

/**
 * Throws a TypeError unless `key` is a non-empty string. Shared by every
 * StorageAdapter implementation so the key contract can't drift between them.
 * @param {unknown} key
 */
export function assertValidKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError(`StorageAdapter key must be a non-empty string, got: ${String(key)}`);
  }
}

/**
 * Throws a TypeError unless `value` is a string. Shared by every
 * StorageAdapter implementation so the value contract can't drift between them.
 * @param {unknown} value
 */
export function assertValidValue(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`StorageAdapter value must be a string, got: ${typeof value}`);
  }
}
