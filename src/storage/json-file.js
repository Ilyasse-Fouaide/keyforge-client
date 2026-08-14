// Phase 1 — default adapter, plain JSON file via node:fs.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertValidKey, assertValidValue } from './adapter.js';

/**
 * Default StorageAdapter (ARCHITECTURE.md §5): a single flat JSON file on
 * disk, `{ [key]: value }`. Not one-file-per-key — the interface never asks
 * for listing/iterating keys, so one file is simpler and sufficient.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] Defaults to `.keyforge-client/state.json`
 *   under the current working directory, mirroring Keyforge's own
 *   cwd-relative convention for local file state (see
 *   `scripts/generate-signing-keypair.js`'s `keys/` directory).
 * @returns {import('./adapter.js').StorageAdapter}
 */
export function createJsonFileAdapter({ filePath } = {}) {
  const resolvedPath = filePath ?? path.join(process.cwd(), '.keyforge-client', 'state.json');
  const tmpPath = `${resolvedPath}.tmp`;

  // Serializes every get/set/delete on this adapter instance so concurrent
  // calls can't interleave a read-modify-write and lose an update.
  let queue = Promise.resolve();
  function enqueue(operation) {
    const result = queue.then(operation);
    // Keep the chain alive even if this operation rejects, so later queued
    // operations still run instead of hanging behind a rejected promise.
    queue = result.catch(() => {});
    return result;
  }

  async function readStore() {
    try {
      return JSON.parse(await readFile(resolvedPath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async function writeStore(store) {
    await mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
    await writeFile(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 });
    await rename(tmpPath, resolvedPath);
  }

  return {
    async get(key) {
      assertValidKey(key);
      return enqueue(async () => {
        const store = await readStore();
        return store[key] ?? null;
      });
    },

    async set(key, value) {
      assertValidKey(key);
      assertValidValue(value);
      return enqueue(async () => {
        const store = await readStore();
        store[key] = value;
        await writeStore(store);
      });
    },

    async delete(key) {
      assertValidKey(key);
      return enqueue(async () => {
        const store = await readStore();
        delete store[key];
        await writeStore(store);
      });
    },
  };
}
